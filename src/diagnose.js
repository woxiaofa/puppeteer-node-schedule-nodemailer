#!/usr/bin/env node
'use strict'

const net = require('net')
const tls = require('tls')
const dnsPromises = require('dns').promises

/**
 * SMTP 自检：DNS → TCP/TLS → SMTP 握手 → 登录，逐层定位发不出邮件的原因。
 * SMTP self-check: DNS → TCP/TLS → SMTP handshake → AUTH, locating the exact failure layer.
 */

const PROVIDER_HINTS = [
  { match: /exmail\.qq\.com/, name: '腾讯企业邮', ports: [465], secure: true, hint: 'SMTP：smtp.exmail.qq.com，465 + SSL；密码用邮箱密码或“客户端专用密码”' },
  { match: /qq\.com/, name: 'QQ 邮箱', ports: [465, 587], secure: true, hint: 'SMTP：smtp.qq.com，465 + SSL；必须用“授权码”，不是 QQ 登录密码' },
  { match: /163\.com|126\.com/, name: '网易邮箱', ports: [465, 994], secure: true, hint: 'SMTP：smtp.163.com，465/994 + SSL；需要开启 SMTP 并使用“授权码”' },
  { match: /gmail\.com/, name: 'Gmail', ports: [465, 587], secure: true, hint: 'SMTP：smtp.gmail.com，465 + SSL；需开启两步验证并使用“应用专用密码”' },
  { match: /outlook\.com|hotmail\.com|live\.com/, name: 'Outlook', ports: [587], secure: false, hint: 'SMTP：smtp.office365.com，587 + STARTTLS（不要勾选 SSL）' },
  { match: /feishu\.cn|larksuite\.com/, name: '飞书邮箱', ports: [465], secure: true, hint: 'SMTP：smtp.feishu.cn，465 + SSL' },
  { match: /aliyun\.com|dingtalk\.com/, name: '阿里邮箱', ports: [465], secure: true, hint: 'SMTP：smtp.qiye.aliyun.com，465 + SSL' }
]

function openSocket({ host, port, secure, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch (_) {
        /* ignore */
      }
      reject(err)
    }
    const timer = setTimeout(() => fail(Object.assign(new Error(`连接超时 ${timeoutMs}ms`), { code: 'ETIMEDOUT' })), timeoutMs)
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(socket)
        })
      : net.connect({ host, port }, () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(socket)
        })
    socket.setTimeout(timeoutMs)
    socket.once('error', fail)
    socket.once('timeout', () => fail(Object.assign(new Error(`连接超时 ${timeoutMs}ms`), { code: 'ETIMEDOUT' })))
    if (secure) socket.once('tlsClientError', (err) => fail(err))
  })
}

function readResponse(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = ''
    let settled = false
    const done = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeListener('data', onData)
      err ? reject(err) : resolve(value)
    }
    const timer = setTimeout(() => done(new Error(`读取 SMTP 响应超时（${timeoutMs}ms）`)), timeoutMs)
    const onData = (chunk) => {
      buf += chunk.toString('utf8')
      if (!/\r?\n$/.test(buf)) return // 等一行完整数据
      const lines = buf.split(/\r?\n/).filter((l) => l.trim().length)
      const last = lines[lines.length - 1] || ''
      // 多行响应：250-xxx 表示未结束，250 xxx 表示结束
      if (/^\d{3}(\s|$)/.test(last) && !/^\d{3}-/.test(last)) done(null, { text: buf, code: Number(last.slice(0, 3)) })
    }
    socket.on('data', onData)
  })
}

async function cmd(socket, command, timeoutMs) {
  socket.write(`${command}\r\n`)
  return readResponse(socket, timeoutMs)
}

const parseCapabilities = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^250[-\s]/.test(l))
    .map((l) => l.slice(4).trim().toUpperCase())

function explain(err, { host, port, secure }) {
  const code = err && err.code
  const message = err && err.message
  const advice = []
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    advice.push(`域名 ${host} 解析失败：SMTP 地址写错，或本机 DNS 配置异常`)
  } else if (code === 'ETIMEDOUT' || /超时/.test(message || '')) {
    advice.push(`连接 ${host}:${port} 超时：多数是本机防火墙 / 云厂商安全组 / 公司网络封了该出口端口`)
    advice.push('可尝试：改用 465 或 587；或在服务器上用 `telnet ' + host + ' ' + port + '` 复测')
  } else if (code === 'ECONNREFUSED') {
    advice.push(`${host}:${port} 拒绝连接：SMTP 地址或端口写错，服务端未开放该端口`)
  } else if (code === 'ECONNRESET') {
    advice.push(`连接被重置：常出现在 25 端口（运营商封禁）或被中间设备拦截`)
  } else if (code === 'EPROTO' || /WRONG_VERSION_NUMBER|SSL/i.test(message || '')) {
    advice.push(
      secure
        ? `该端口不是 SSL 端口，但你勾选了 SSL：请改用 STARTTLS（取消勾选，一般用 587）`
        : `该端口要求 SSL/TLS 加密，但你没勾选：请勾选 SSL（一般是 465）`
    )
  } else if (/certificate|CERT_/i.test(message || '')) {
    advice.push('TLS 证书校验异常：可先在服务端/本机校准时间，或联系邮箱服务商')
  } else {
    advice.push(`底层错误：${code || '未知'} ${message || ''}`)
  }
  return advice
}

/** 探测单个 host:port 组合 */
async function probeOne({ host, port, secure, timeoutMs, auth }) {
  const report = { host, port, secure, ok: false, stage: '', greeting: '', capabilities: [], authResult: null, advice: [] }
  let socket = null
  try {
    report.stage = 'connect'
    socket = await openSocket({ host, port, secure, timeoutMs })

    report.stage = 'greeting'
    const hello = await readResponse(socket, timeoutMs)
    report.greeting = (hello.text || '').split(/\r?\n/)[0]
    if (Number(hello.code) !== 220) {
      report.advice.push(`服务端问候异常（${hello.code}）：${report.greeting}`)
      throw new Error(`非标准 SMTP 问候语：${report.greeting}`)
    }

    report.stage = 'ehlo'
    const ehlo = await cmd(socket, 'EHLO localhost', timeoutMs)
    report.capabilities = parseCapabilities(ehlo.text)

    if (!secure && !report.capabilities.includes('STARTTLS')) {
      report.advice.push('该端口不支持 STARTTLS，明文发信可能被拒')
    }
    if (port === 587 && secure) {
      report.advice.push('587 端口使用 STARTTLS：请取消勾选 SSL（secure=false）')
    }
    if (port === 465 && !secure) {
      report.advice.push('465 端口是隐式 SSL：请勾选 SSL（secure=true）')
    }
    if (port === 25) {
      report.advice.push('25 端口常被运营商与云厂商封禁，建议改用 465 / 587')
    }
    if (!report.capabilities.some((c) => c.startsWith('AUTH'))) {
      report.advice.push('服务端未声明 AUTH，可能是中继端口或未开启 SMTP 发信功能')
    }

    if (auth && auth.user && auth.pass) {
      report.stage = 'auth'
      const supportsAuth = report.capabilities.some((c) => c.startsWith('AUTH'))
      const secured = secure || (!secure && false) // 明文下也允许尝试，但会提示风险
      if (!supportsAuth) {
        report.authResult = { ok: false, code: 0, message: '服务端未声明 AUTH' }
      } else {
        await cmd(socket, 'AUTH LOGIN', timeoutMs)
        await cmd(socket, Buffer.from(auth.user).toString('base64'), timeoutMs)
        const res = await cmd(socket, Buffer.from(auth.pass).toString('base64'), timeoutMs)
        const msg = (res.text || '').split(/\r?\n/).filter(Boolean).pop()
        report.authResult = { ok: res.code === 235, code: res.code, message: msg }
        if (res.code === 535) {
          report.advice.push('账号或密码错误：QQ/163/Gmail 等邮箱必须用“授权码/应用专用密码”，且账号要写完整邮箱地址')
        } else if (res.code === 530) {
          report.advice.push('530：需要先建立加密连接（STARTTLS/SSL）再登录')
        } else if (res.code === 534) {
          report.advice.push('534：服务器要求更强的认证方式，检查是否开启 SMTP 服务')
        }
      }
      if (!secured) {
        /* 明文探测仅用于诊断 */
      }
    }

    await cmd(socket, 'QUIT', 3000).catch(() => {})
    report.ok = true
  } catch (err) {
    report.error = { code: err.code || '', message: err.message }
    report.advice = explain(err, { host, port, secure }).concat(report.advice)
  } finally {
    if (socket) {
      try {
        socket.destroy()
      } catch (_) {
        /* ignore */
      }
    }
  }
  return report
}

function providerHint(user) {
  const from = String(user || '')
  return PROVIDER_HINTS.find((p) => p.match.test(from))
}

/** 常见笔误：漏写 smtp. 前缀 / common typo: missing the smtp. prefix */
function suggestHost(host) {
  const value = String(host || '').trim().toLowerCase()
  if (!value) return null
  if (/^smtp\./.test(value)) return null
  if (/^mail\./.test(value)) return value.replace(/^mail\./, 'smtp.')
  if (/^(pop|imap|imap4)\./.test(value)) return value.replace(/^(pop|imap|imap4)\./, 'smtp.')
  return `smtp.${value}`
}

/**
 * 完整诊断：先测当前配置，失败时自动尝试该域名的其它常用端口。
 * Full diagnosis: test current config, then fall back to common ports for that provider.
 */
async function diagnose({ mail, timeoutMs = 15000 }) {
  const result = { config: { host: mail.host, port: mail.port, secure: mail.secure, user: mail.user }, reports: [], advice: [] }
  if (!mail.host) {
    result.advice.push('SMTP_HOST 为空：完全没有配置邮件服务器')
    return result
  }

  try {
    const address = await dnsPromises.lookup(mail.host)
    result.dns = address
  } catch (err) {
    result.advice.push(`DNS 解析 ${mail.host} 失败：${err.code || err.message}`)
    result.advice.push('检查 SMTP 地址是否写错（如 qq 邮箱应为 smtp.qq.com，企业邮为 smtp.exmail.qq.com）')
    return result
  }

  const current = await probeOne({
    host: mail.host,
    port: mail.port,
    secure: mail.secure,
    timeoutMs,
    auth: { user: mail.user, pass: mail.pass }
  })
  result.reports.push(current)

  if (!current.ok) {
    const suggestion = suggestHost(mail.host)
    if (suggestion) {
      result.advice.push(`SMTP 地址疑似写错：${mail.host} → 试试 ${suggestion}（多数邮箱地址为 smtp.xxx.com）`)
    }
    const hint = providerHint(mail.user || mail.host)
    const hosts = [mail.host]
    if (suggestion) hosts.push(suggestion)
    const ports = []
      .concat(hint && hint.ports ? hint.ports : [], [465, 587, 25])
      .filter((p, i, arr) => arr.indexOf(p) === i)

    const seen = new Set()
    const combos = []
    for (const host of hosts) {
      for (const port of ports) {
        const key = `${host}:${port}`
        if (key === `${mail.host}:${mail.port}` || seen.has(key)) continue
        seen.add(key)
        combos.push({ host, port })
      }
    }

    for (const combo of combos.slice(0, 4)) {
      const probe = await probeOne({
        host: combo.host,
        port: combo.port,
        secure: combo.port === 465,
        timeoutMs: 8000,
        auth: { user: mail.user, pass: mail.pass }
      })
      probe.fallback = true
      result.reports.push(probe)
      if (probe.ok) break
    }
    if (hint) result.advice.push(`${hint.name}建议：${hint.hint}`)
  }

  const working = result.reports.find((r) => r.ok && (r.authResult == null || r.authResult.ok))
  if (working) {
    result.advice.unshift(
      `可用组合：${working.host}:${working.port} secure=${working.secure}${
        working.authResult ? `（登录${working.authResult.ok ? '成功' : '失败：' + working.authResult.message}）` : ''
      }`
    )
  } else if (result.reports.every((r) => !r.ok)) {
    result.advice.unshift('所有测试的端口都连不通：优先排查本机/服务器出口防火墙与安全组')
  }
  return result
}

function render(result) {
  const lines = []
  const cfg = result.config
  lines.push(`SMTP 自检报告 / SMTP diagnosis`)
  lines.push(`目标：${cfg.host}:${cfg.port} secure=${cfg.secure} user=${cfg.user || '(未配置)'}`)
  if (result.dns) lines.push(`DNS 解析：${cfg.host} → ${result.dns.address}（IPv${result.dns.family}）`)
  lines.push('')
  for (const r of result.reports) {
    lines.push(`  ${r.fallback ? '[备选] ' : ''}${r.host}:${r.port} secure=${r.secure} → ${r.ok ? '连通' : '失败（' + r.stage + ' 阶段）'}`)
    if (r.greeting) lines.push(`      问候语：${r.greeting}`)
    if (r.capabilities.length) lines.push(`      能力：${r.capabilities.join(' ')}`)
    if (r.authResult) lines.push(`      登录：${r.authResult.ok ? '成功' : `失败 ${r.authResult.code} ${r.authResult.message}`}`)
    if (r.error) lines.push(`      错误：${r.error.code} ${r.error.message}`)
    for (const a of r.advice) lines.push(`      → ${a}`)
  }
  lines.push('')
  lines.push('建议 / Advice:')
  for (const a of [...new Set(result.advice)]) lines.push(`  - ${a}`)
  return lines.join('\n')
}

module.exports = { diagnose, probeOne, render }

if (require.main === module) {
  const { config } = require('../config')
  diagnose({ mail: config.mail })
    .then((result) => {
      console.log('\n' + render(result) + '\n')
      process.exit(result.reports.some((r) => r.ok) ? 0 : 1)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
