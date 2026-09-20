'use strict'

const fs = require('fs')
const nodemailer = require('nodemailer')

const { retry, withTimeout, escapeHtml, formatBytes } = require('./utils')

const rowHtml = (r) => {
  const status = r.ok ? '<span style="color:#2e7d32">成功</span>' : '<span style="color:#c62828">失败</span>'
  const notes = [r.error, ...(r.warnings || [])].filter(Boolean).map(escapeHtml).join('；')
  return `<tr>
    <td>${escapeHtml(r.name)}</td>
    <td><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></td>
    <td>${escapeHtml(r.viewport || '')}</td>
    <td>${status}</td>
    <td>${(r.durationMs / 1000).toFixed(1)}s</td>
    <td>${notes || '-'}</td>
  </tr>`
}

function buildHtml(summary, images) {
  const table = summary.results.map(rowHtml).join('')
  const gallery = images
    .map(
      (img) =>
        `<div style="margin:16px 0"><div style="font-weight:600">${escapeHtml(img.name)}</div><img src="cid:${img.cid}" style="max-width:100%;border:1px solid #e0e0e0"/></div>`
    )
    .join('')
  const failedCount = summary.failed
  const banner = failedCount
    ? `<p style="color:#c62828">有 ${failedCount} 个站点截图失败，详见下方表格。</p>`
    : '<p style="color:#2e7d32">全部站点截图成功。</p>'

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222">
  <h3>${escapeHtml(summary.title)}</h3>
  <p>执行时间：${escapeHtml(summary.finishedAtText)}｜耗时 ${(summary.durationMs / 1000).toFixed(1)}s｜成功 ${summary.succeeded}/${summary.total}</p>
  ${banner}
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
    <thead><tr><th>站点</th><th>地址</th><th>视口</th><th>状态</th><th>耗时</th><th>备注</th></tr></thead>
    <tbody>${table}</tbody>
  </table>
  ${gallery || '<p>（没有可展示的截图）</p>'}
  <p style="color:#888;font-size:12px">本邮件由 site-shot 自动发送 / Sent automatically by site-shot.</p>
</div>`
}

function buildText(summary) {
  const lines = summary.results.map(
    (r) => `${r.ok ? '[成功]' : '[失败]'} ${r.name} ${r.url} ${(r.durationMs / 1000).toFixed(1)}s ${r.error || (r.warnings || []).join('；')}`
  )
  return [
    summary.title,
    `执行时间: ${summary.finishedAtText}`,
    `耗时: ${(summary.durationMs / 1000).toFixed(1)}s`,
    `成功: ${summary.succeeded}/${summary.total}`,
    '',
    ...lines
  ].join('\n')
}

/** 组装附件：不存在/超限的文件会被跳过，保证邮件一定能发出去 */
function buildAttachments(summary, maxBytes, logger) {
  const files = summary.results
    .filter((r) => r.ok && r.file && fs.existsSync(r.file))
    .map((r) => ({ name: r.name, cid: `img-${r.key}`, path: r.file, size: fs.statSync(r.file).size }))

  let total = files.reduce((sum, f) => sum + f.size, 0)
  let images = files
  if (total > maxBytes) {
    logger.warn(`附件合计 ${formatBytes(total)} 超过上限 ${formatBytes(maxBytes)}，本次只发送文字报告`)
    images = []
    total = 0
  }

  const attachments = images.map((f) => ({
    filename: `${f.name.replace(/[\\/:*?"<>|]/g, '_')}.png`,
    path: f.path,
    cid: f.cid
  }))

  if (summary.reportFile && fs.existsSync(summary.reportFile)) {
    attachments.push({ filename: 'report.txt', path: summary.reportFile })
  }
  return { attachments, images, totalBytes: total }
}

/**
 * 把发信错误翻译成可执行的排查建议，避免日志里只有一句“超时”。
 * Translate mail errors into actionable hints instead of a bare "timeout".
 */
function enhanceError(err, mail) {
  const code = err.code || err.responseCode || ''
  const hints = []
  if (code === 'ETIMEDOUT' || /timeout|超时/i.test(err.message)) {
    hints.push(`连不上 ${mail.host}:${mail.port}：检查 SMTP 地址是否少了 smtp. 前缀、本机/服务器防火墙是否封了该出口端口`)
  }
  if (code === 'EAUTH' || /535|Username and Password|Invalid login/i.test(err.message)) {
    hints.push('账号或密码错误：QQ/163/Gmail 必须用“授权码/应用专用密码”，账号要写完整邮箱地址')
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    hints.push('SMTP 域名解析失败：SMTP 地址写错了')
  }
  if (code === 'ECONNREFUSED') {
    hints.push('端口拒绝连接：确认端口与加密方式匹配（465 勾选 SSL，587 不勾选）')
  }
  if (code === 'ESOCKET' || /wrong version number/i.test(err.message)) {
    hints.push('加密方式不匹配：SSL 端口要用 secure=true，STARTTLS 端口要用 secure=false')
  }
  if (code === 'EENVELOPE' || /No recipients defined/i.test(err.message)) {
    hints.push(
      `收件人无效或为空（当前：${(mail.to || []).join(', ') || '空'}）：请填写真实邮箱地址，例如 name@example.com`
    )
  }
  if (/Invalid recipient|User unknown/i.test(err.message)) {
    hints.push('收件人地址被服务器拒绝：确认邮箱地址是否正确')
  }
  hints.push('可执行 npm run doctor:mail 做逐层自检')
  const enhanced = new Error(
    [`${err.message}（${code ? code + '，' : ''}${mail.host}:${mail.port} secure=${mail.secure}）`, ...hints].join(' | ')
  )
  enhanced.code = code
  enhanced.cause = err
  return enhanced
}

function createTransporter(mail) {
  return nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: mail.secure,
    auth: { user: mail.user, pass: mail.pass },
    connectionTimeout: mail.timeoutMs,
    greetingTimeout: mail.timeoutMs,
    socketTimeout: mail.timeoutMs * 2
  })
}

/**
 * 发送邮件报告：先验证 SMTP（快速失败），再指数退避重试发送。
 * Send the report: verify SMTP first (fail fast), then retry with backoff.
 */
async function sendReport({ config, summary, logger }) {
  const mail = config.mail
  const transporter = createTransporter(mail)

  try {
    await withTimeout(transporter.verify(), mail.timeoutMs, 'SMTP 连接/登录超时')
    logger.info('SMTP 连接验证通过')

    const { attachments, images } = buildAttachments(summary, mail.maxAttachmentBytes, logger)
    const subject = `${mail.subjectPrefix} ${summary.dayText} · 成功 ${summary.succeeded}/${summary.total}${
      summary.failed ? ` · ${summary.failed} 个失败` : ''
    }`

    const info = await retry(
      () =>
        transporter.sendMail({
          from: mail.from,
          to: mail.to.join(', '),
          cc: mail.cc.length ? mail.cc.join(', ') : undefined,
          subject,
          text: buildText(summary),
          html: buildHtml(summary, images),
          attachments
        }),
      {
        times: Math.max(1, mail.retries),
        delayMs: 5000,
        onRetry: (err, attempt, wait) => logger.warn(`发信失败(${err.message})，${wait}ms 后第 ${attempt + 1} 次重试`)
      }
    )

    logger.info(`邮件发送成功：${info.messageId || info.response}`)
    return info
  } catch (err) {
    throw enhanceError(err, mail)
  } finally {
    try {
      transporter.close()
    } catch (_) {
      /* ignore */
    }
  }
}

/** 界面上的“发送测试邮件” / "Send test mail" button in the web UI */
async function sendTestMail({ config, logger }) {
  const mail = config.mail
  if (!mail.enabled) throw new Error('邮件配置不完整（host / user / pass / 收件人）')
  if (!mail.to.length) throw new Error('收件人为空：请在「邮件配置」里填写至少一个邮箱地址')
  const transporter = createTransporter(mail)
  try {
    await withTimeout(transporter.verify(), mail.timeoutMs, 'SMTP 连接/登录超时')
    const info = await transporter.sendMail({
      from: mail.from || mail.user,
      to: mail.to.join(', '),
      subject: `${mail.subjectPrefix} · 测试邮件 / test mail`,
      text: `这是一封来自 site-shot 的测试邮件，收到说明邮件配置正确。\n时间：${new Date().toLocaleString('zh-CN', {
        hour12: false
      })}\n收件人：${mail.to.join(', ')}`
    })
    logger.info(`测试邮件发送成功：${info.messageId || info.response}`)
    return info
  } catch (err) {
    throw enhanceError(err, mail)
  } finally {
    try {
      transporter.close()
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = { sendReport, sendTestMail, buildText, enhanceError }
