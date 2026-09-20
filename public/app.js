'use strict'

const $ = (id) => document.getElementById(id)
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

let cfg = null
let currentRunId = null

function toast(message, type = '') {
  const el = $('toast')
  el.textContent = message
  el.className = `toast show ${type}`
  clearTimeout(el._timer)
  el._timer = setTimeout(() => {
    el.className = 'toast'
  }, 3200)
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const messages = Array.isArray(data.errors) ? data.errors.map((e) => e.message || e) : []
    const err = new Error(data.message || messages.join('；') || `HTTP ${res.status}`)
    err.errors = Array.isArray(data.errors) ? data.errors : null
    throw err
  }
  return data
}

/* ---------------- 字段级校验提示 ---------------- */
const SITE_FIELD_SELECTOR = {
  key: '.s-name',
  name: '.s-name',
  url: '.s-url',
  viewportWidth: '.s-w',
  viewportHeight: '.s-h',
  userAgent: '.s-ua',
  waitForSelector: '.s-sel',
  fullPage: '.s-full'
}

function clearErrors() {
  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'))
  document.querySelectorAll('em.err').forEach((el) => el.remove())
}

function markField(el, message) {
  if (!el) return
  el.classList.add('invalid')
  let hint = el.parentElement.querySelector('em.err')
  if (!hint) {
    hint = document.createElement('em')
    hint.className = 'err'
    el.parentElement.appendChild(hint)
  }
  hint.textContent = hint.textContent ? `${hint.textContent}；${message}` : message
}

function switchToElement(el) {
  const panel = el.closest('.panel')
  if (!panel) return
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === panel.dataset.panel))
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p === panel))
}

function showErrors(errors) {
  clearErrors()
  const rest = []
  for (const item of errors) {
    const field = item.field || ''
    if (field.startsWith('sites.')) {
      const [, index, name] = field.split('.')
      const row = document.querySelectorAll('#site-rows .site-row')[Number(index)]
      if (row) {
        markField(row.querySelector(SITE_FIELD_SELECTOR[name] || '.s-name'), item.message)
        continue
      }
    }
    const el = document.getElementById(field)
    if (el) markField(el, item.message)
    else rest.push(item.message)
  }
  if (rest.length) toast(rest.join('；'), 'err')
  else toast(`有 ${errors.length} 项配置需要修正（已标红）`, 'err')
  const first = document.querySelector('.invalid')
  if (first) {
    switchToElement(first)
    first.scrollIntoView({ behavior: 'smooth', block: 'center' })
    first.focus({ preventScroll: true })
  }
}

/** 本地先校验一遍，非法就不请求后端 */
function validateForm() {
  const payload = collect()
  const errors = window.SiteShotRules.validateExternal(payload, {
    hasSavedPass: Boolean(cfg && cfg.mail && cfg.mail.hasPass)
  })
  if (errors.length) {
    showErrors(errors)
    return false
  }
  clearErrors()
  return true
}

document.addEventListener('input', (e) => {
  const el = e.target
  if (!el || !el.classList || !el.classList.contains('invalid')) return
  el.classList.remove('invalid')
  const hint = el.parentElement && el.parentElement.querySelector('em.err')
  if (hint) hint.remove()
})

/* ---------------- 标签页 ---------------- */
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn))
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab))
    if (btn.dataset.tab === 'history') loadHistory()
    if (btn.dataset.tab === 'logs') loadLogs()
    if (btn.dataset.tab === 'overview') refreshStatus()
  })
})

/* ---------------- 配置表单 ---------------- */
function siteRowHtml(site) {
  const s = site || {}
  const fullPage = s.fullPage === true ? 'true' : s.fullPage === false ? 'false' : ''
  return `<div class="site-row" data-key="${s.key || ''}">
    <input class="s-name" placeholder="名称" value="${(s.name || '').replace(/"/g, '&quot;')}" />
    <input class="s-url" placeholder="https://example.com" value="${(s.url || '').replace(/"/g, '&quot;')}" />
    <input class="s-w" type="number" value="${(s.viewport && s.viewport.width) || 1600}" />
    <input class="s-h" type="number" value="${(s.viewport && s.viewport.height) || 900}" />
    <input class="s-ua" placeholder="移动端 UA（可选）" value="${(s.userAgent || '').replace(/"/g, '&quot;')}" />
    <select class="s-full">
      <option value=""${fullPage === '' ? ' selected' : ''}>继承</option>
      <option value="true"${fullPage === 'true' ? ' selected' : ''}>整页</option>
      <option value="false"${fullPage === 'false' ? ' selected' : ''}>首屏</option>
    </select>
    <input class="s-sel" placeholder=".banner" value="${(s.waitForSelector || '').replace(/"/g, '&quot;')}" />
    <button class="btn danger" data-act="del" title="删除">×</button>
  </div>`
}

function renderSites(sites) {
  const box = $('site-rows')
  box.innerHTML = (sites || []).map(siteRowHtml).join('')
  box.querySelectorAll('[data-act="del"]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.site-row').remove())
  })
}

function fillForm(c) {
  $('cron').value = c.schedule.cron
  $('timezone').value = c.schedule.timezone
  $('runOnStart').checked = !!c.schedule.runOnStart

  $('concurrency').value = c.capture.concurrency
  $('navigationTimeoutMs').value = c.capture.navigationTimeoutMs
  $('waitUntil').value = c.capture.waitUntil
  $('extraWaitMs').value = c.capture.extraWaitMs
  $('retries').value = c.capture.retries
  $('maxImageMb').value = c.capture.maxImageMb
  $('fullPage').checked = !!c.capture.fullPage
  $('autoScroll').checked = !!c.capture.autoScroll
  $('retentionDays').value = c.storage.retentionDays
  $('executablePath').value = c.browser.executablePath || ''

  $('smtpHost').value = c.mail.host
  $('smtpPort').value = c.mail.port
  $('smtpUser').value = c.mail.user
  $('smtpPass').value = ''
  $('pass-hint').textContent = c.mail.hasPass ? '已保存密码，留空表示不修改' : '建议使用邮箱授权码而非登录密码'
  $('mailFrom').value = c.mail.from
  $('mailTo').value = (c.mail.to || []).join(', ')
  $('mailCc').value = (c.mail.cc || []).join(', ')
  $('subjectPrefix').value = c.mail.subjectPrefix
  $('maxAttachmentMb').value = c.mail.maxAttachmentMb
  $('smtpSecure').checked = !!c.mail.secure

  renderSites(c.sites)
}

function collect() {
  const sites = Array.from(document.querySelectorAll('#site-rows .site-row')).map((row) => ({
    key: row.dataset.key || '',
    name: row.querySelector('.s-name').value.trim(),
    url: row.querySelector('.s-url').value.trim(),
    viewport: {
      width: Number(row.querySelector('.s-w').value) || 1600,
      height: Number(row.querySelector('.s-h').value) || 900
    },
    userAgent: row.querySelector('.s-ua').value.trim(),
    fullPage: row.querySelector('.s-full').value,
    waitForSelector: row.querySelector('.s-sel').value.trim()
  }))

  return {
    schedule: {
      cron: $('cron').value.trim(),
      timezone: $('timezone').value.trim() || 'Asia/Shanghai',
      runOnStart: $('runOnStart').checked
    },
    capture: {
      concurrency: $('concurrency').value,
      navigationTimeoutMs: $('navigationTimeoutMs').value,
      waitUntil: $('waitUntil').value,
      extraWaitMs: $('extraWaitMs').value,
      retries: $('retries').value,
      maxImageMb: $('maxImageMb').value,
      fullPage: $('fullPage').checked,
      autoScroll: $('autoScroll').checked,
      minContentLength: cfg ? cfg.capture.minContentLength : 50
    },
    mail: {
      host: $('smtpHost').value.trim(),
      port: $('smtpPort').value,
      secure: $('smtpSecure').checked,
      user: $('smtpUser').value.trim(),
      pass: $('smtpPass').value,
      from: $('mailFrom').value.trim(),
      to: $('mailTo').value,
      cc: $('mailCc').value,
      subjectPrefix: $('subjectPrefix').value.trim(),
      maxAttachmentMb: $('maxAttachmentMb').value
    },
    browser: { executablePath: $('executablePath').value.trim() },
    storage: { retentionDays: $('retentionDays').value },
    sites
  }
}

async function loadConfig() {
  const data = await api('/api/config')
  cfg = data.config
  fillForm(cfg)
}

/** 校验 + 保存，返回是否成功（保存、测试邮件共用） */
async function persistConfig() {
  if (!validateForm()) return false
  const payload = collect()
  try {
    const data = await api('/api/config', { method: 'PUT', body: JSON.stringify(payload) })
    await loadConfig()
    refreshStatus()
    ;(data.warnings || []).forEach((w) => console.warn(w))
    return data
  } catch (err) {
    if (err.errors) showErrors(err.errors)
    else toast(`保存失败：${err.message}`, 'err')
    return false
  }
}

async function saveConfig() {
  const data = await persistConfig()
  if (!data) return
  const next = data.nextRun ? new Date(data.nextRun).toLocaleString('zh-CN', { hour12: false }) : '未知'
  toast(`配置已保存，下次执行：${next}`, 'ok')
}

/* ---------------- 状态 / 执行 ---------------- */
function fmt(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return isNaN(d) ? String(dateStr) : d.toLocaleString('zh-CN', { hour12: false })
}

async function refreshStatus() {
  try {
    const s = await api('/api/status')
    const run = $('chip-run')
    run.textContent = s.running ? '执行中…' : '空闲'
    run.classList.toggle('running', !!s.running)
    $('chip-next').textContent = `下次执行：${fmt(s.nextRun)}`
    $('chip-mail').textContent = `邮件：${s.mailEnabled ? '已开启' : '未配置'}`
    $('stat-sites').textContent = s.siteCount
    $('stat-next').textContent = fmt(s.nextRun)
    $('stat-mail').textContent = s.mailEnabled ? '已开启' : '未配置（只存本地）'
    $('cfg-path').textContent = s.configFile
    $('out-path').textContent = s.outputDir

    if (s.lastRun) {
      $('stat-last').textContent = `${s.lastRun.succeeded}/${s.lastRun.total} 成功`
      $('last-run').innerHTML = `<div>${s.lastRun.finishedAtText} · 成功 ${s.lastRun.succeeded}/${s.lastRun.total}${
        s.lastRun.mailError ? ` · <span style="color:var(--err)">邮件失败：${s.lastRun.mailError}</span>` : ''
      }</div><div class="muted">目录：${s.lastRun.id}</div>`
    } else {
      $('stat-last').textContent = '-'
    }
    return s
  } catch (err) {
    toast(`状态获取失败：${err.message}`, 'err')
  }
}

async function triggerRun() {
  try {
    await api('/api/run', { method: 'POST' })
    toast('已在后台开始执行，可在「运行日志」查看进度', 'ok')
    setTimeout(refreshStatus, 1500)
    const timer = setInterval(async () => {
      const s = await refreshStatus()
      if (s && !s.running) {
        clearInterval(timer)
        loadHistory()
      }
    }, 4000)
  } catch (err) {
    toast(err.message, 'err')
  }
}

async function testMail() {
  const saved = await persistConfig()
  if (!saved) return
  try {
    const data = await api('/api/test-mail', { method: 'POST' })
    toast(data.message, 'ok')
  } catch (err) {
    toast(`测试邮件失败：${err.message}`, 'err')
  }
}

async function diagnoseMail() {
  const box = $('diag-box')
  box.hidden = false
  box.textContent = '正在逐层自检（DNS → 端口 → SMTP 握手 → 登录），约需 10~30 秒…'
  try {
    const data = await api('/api/mail/diagnose', { method: 'POST' })
    box.textContent = data.report
    toast(data.ok ? '已找到可用组合，见下方报告' : '全部端口不通，见下方报告', data.ok ? 'ok' : 'err')
  } catch (err) {
    box.textContent = `诊断失败：${err.message}`
  }
}
async function loadHistory() {
  const box = $('history-list')
  try {
    const data = await api('/api/history')
    if (!data.runs.length) {
      box.innerHTML = '<span class="muted">还没有运行记录，点「立即执行」试一次。</span>'
      return
    }
    box.innerHTML = data.runs
      .map(
        (r) => `<div class="history-item" data-id="${r.id}">
          <div>
            <div>${r.finishedAtText}</div>
            <div class="muted">${r.id}${r.mailError ? ' · 邮件发送失败' : ''}</div>
          </div>
          <div class="row">
            <span class="badge ${r.failed ? 'bad' : ''}">${r.succeeded}/${r.total} 成功</span>
            <span class="muted">${((r.durationMs || 0) / 1000).toFixed(1)}s</span>
          </div>
        </div>`
      )
      .join('')
    box.querySelectorAll('.history-item').forEach((item) => {
      item.addEventListener('click', () => openRun(item.dataset.id))
    })
  } catch (err) {
    box.innerHTML = `<span style="color:var(--err)">${err.message}</span>`
  }
}

async function openRun(id) {
  currentRunId = id
  try {
    const run = await api(`/api/history/${encodeURIComponent(id)}`)
    const rows = (run.results || [])
      .map((r) => {
        const shots = r.ok
          ? `<div class="shot"><img src="/api/history/${encodeURIComponent(id)}/file/${encodeURIComponent(
              r.key + '.png'
            )}" alt="${r.name}" loading="lazy" /><div class="meta">${r.name} · ${r.viewport}</div></div>`
          : `<div class="shot"><div class="meta" style="color:var(--err)">${r.name} 失败：${r.error || '未知原因'}</div></div>`
        return shots
      })
      .join('')
    $('history-detail-wrap').hidden = false
    $('history-detail').innerHTML = `<div class="muted">${run.finishedAtText} · 耗时 ${(
      run.durationMs / 1000
    ).toFixed(1)}s · 成功 ${run.succeeded}/${run.total}</div><div class="shots">${rows}</div>`
  } catch (err) {
    toast(`加载详情失败：${err.message}`, 'err')
  }
}

/* ---------------- 日志 ---------------- */
async function loadLogs() {
  try {
    const data = await api('/api/logs?lines=300')
    $('log-box').textContent = data.lines.length ? data.lines.join('\n') : '（暂无日志）'
  } catch (err) {
    $('log-box').textContent = `加载失败：${err.message}`
  }
}

/* ---------------- 事件绑定 ---------------- */
$('btn-save').addEventListener('click', () => saveConfig().catch((e) => toast(`保存失败：${e.message}`, 'err')))
$('btn-run').addEventListener('click', triggerRun)
$('btn-run2').addEventListener('click', triggerRun)
$('btn-test-mail').addEventListener('click', testMail)
$('btn-test-mail2').addEventListener('click', testMail)
$('btn-diag-mail').addEventListener('click', diagnoseMail)
$('btn-reload').addEventListener('click', () => loadConfig().then(refreshStatus).then(() => toast('已重新加载', 'ok')))
$('btn-history').addEventListener('click', loadHistory)
$('btn-logs').addEventListener('click', loadLogs)
$('log-auto').addEventListener('change', (e) => {
  clearInterval(window._logTimer)
  if (e.target.checked) window._logTimer = setInterval(loadLogs, 5000)
})

document.querySelectorAll('[data-cron]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $('cron').value = btn.dataset.cron
  })
})

$('btn-add-site').addEventListener('click', () => {
  const box = $('site-rows')
  box.insertAdjacentHTML('beforeend', siteRowHtml({ name: '新站点', url: 'https://' }))
  bindDelete()
})

$('btn-add-mobile').addEventListener('click', () => {
  const rows = document.querySelectorAll('#site-rows .site-row')
  const last = rows[rows.length - 1]
  const base = last
    ? {
        name: last.querySelector('.s-name').value + ' 移动端',
        url: last.querySelector('.s-url').value,
        viewport: { width: 414, height: 736 },
        userAgent: MOBILE_UA
      }
    : { name: '移动端', url: 'https://', viewport: { width: 414, height: 736 }, userAgent: MOBILE_UA }
  $('site-rows').insertAdjacentHTML('beforeend', siteRowHtml(base))
  bindDelete()
})

function bindDelete() {
  document.querySelectorAll('#site-rows [data-act="del"]').forEach((btn) => {
    btn.onclick = () => btn.closest('.site-row').remove()
  })
}

/* ---------------- 启动 ---------------- */
;(async function init() {
  try {
    await loadConfig()
    await refreshStatus()
    await loadHistory()
    await loadLogs()
    setInterval(refreshStatus, 10000)
  } catch (err) {
    toast(`初始化失败：${err.message}`, 'err')
  }
})()
