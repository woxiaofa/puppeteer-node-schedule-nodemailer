'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

const DATA_DIR = path.join(ROOT, 'data')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const PASS_MASK = '******'

function read() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch (err) {
    console.warn(`读取 ${CONFIG_FILE} 失败：${err.message}`)
    return null
  }
}

function write(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8')
}

const clampNum = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

const toBool = (value, fallback = false) => {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const toList = (value) =>
  Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : String(value || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)

const rules = require('../public/validate.js')

const slug = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** 外部（界面）数据 → 内部配置，含校验 / external payload → internal config with validation */
function normalize(payload = {}, current) {
  const input = payload || {}
  // 与界面完全一致的字段级校验（前后端共用 public/validate.js）
  const errors = rules.validateExternal(input, {
    hasSavedPass: Boolean(current && current.mail && current.mail.pass)
  })
  const sites = (Array.isArray(input.sites) ? input.sites : []).map((site, index) => {
    const url = String((site && site.url) || '').trim()
    const name = String((site && site.name) || '').trim()
    const key = String((site && site.key) || '').trim() || slug(name || url) || `site-${index + 1}`
    return {
      key,
      name: name || key,
      url,
      viewport: {
        width: clampNum(site && site.viewport && site.viewport.width, 1600, 320, 3840),
        height: clampNum(site && site.viewport && site.viewport.height, 900, 320, 4320)
      },
      userAgent: String((site && site.userAgent) || '').trim() || null,
      fullPage: site && site.fullPage != null && site.fullPage !== '' ? toBool(site.fullPage) : null,
      waitForSelector: String((site && site.waitForSelector) || '').trim() || null
    }
  })
  const cron = String((input.schedule && input.schedule.cron) || '').trim()
  const port = clampNum(input.mail && input.mail.port, 465, 1, 65535)
  const rawPass = String((input.mail && input.mail.pass) || '')
  const pass = rawPass && rawPass !== PASS_MASK ? rawPass : (current && current.mail.pass) || ''

  const user = {
    schedule: {
      cron,
      timezone: String((input.schedule && input.schedule.timezone) || 'Asia/Shanghai').trim(),
      runOnStart: toBool(input.schedule && input.schedule.runOnStart, false)
    },
    capture: {
      concurrency: clampNum(input.capture && input.capture.concurrency, 2, 1, 8),
      navigationTimeoutMs: clampNum(input.capture && input.capture.navigationTimeoutMs, 30000, 3000, 180000),
      waitUntil: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(
        String(input.capture && input.capture.waitUntil)
      )
        ? String(input.capture.waitUntil)
        : 'networkidle2',
      extraWaitMs: clampNum(input.capture && input.capture.extraWaitMs, 1500, 0, 30000),
      fullPage: toBool(input.capture && input.capture.fullPage, true),
      retries: clampNum(input.capture && input.capture.retries, 2, 0, 5),
      maxImageBytes: clampNum(input.capture && input.capture.maxImageMb, 10, 1, 50) * 1024 * 1024,
      autoScroll: toBool(input.capture && input.capture.autoScroll, true),
      minContentLength: clampNum(input.capture && input.capture.minContentLength, 50, 0, 5000)
    },
    mail: {
      host: String((input.mail && input.mail.host) || '').trim(),
      port,
      secure: input.mail && input.mail.secure != null ? toBool(input.mail.secure) : port === 465,
      user: String((input.mail && input.mail.user) || '').trim(),
      pass,
      from: String((input.mail && input.mail.from) || '').trim(),
      to: toList(input.mail && input.mail.to),
      cc: toList(input.mail && input.mail.cc),
      subjectPrefix: String((input.mail && input.mail.subjectPrefix) || '网站截图日报').trim(),
      maxAttachmentBytes: clampNum(input.mail && input.mail.maxAttachmentMb, 15, 1, 50) * 1024 * 1024
    },
    browser: {
      executablePath: String((input.browser && input.browser.executablePath) || '').trim() || undefined
    },
    storage: {
      retentionDays: clampNum(input.storage && input.storage.retentionDays, 7, 0, 365)
    },
    sites
  }

  return { user, errors }
}

/** 把用户配置合并进运行时配置 / merge persisted user config into the runtime config */
function apply(config, user) {
  if (!user) return config
  if (user.schedule) Object.assign(config.schedule, user.schedule)
  if (user.capture) Object.assign(config.capture, user.capture)
  if (user.browser) Object.assign(config.browser, user.browser)
  if (user.storage) Object.assign(config.storage, user.storage)
  if (user.mail) {
    Object.assign(config.mail, user.mail)
    config.mail.enabled = Boolean(
      config.mail.host && config.mail.user && config.mail.pass && config.mail.to.length > 0
    )
    if (!config.mail.from) config.mail.from = config.mail.user
  }
  if (Array.isArray(user.sites) && user.sites.length) config.sites = user.sites
  return config
}

/** 运行时配置 → 界面数据（密码脱敏）/ runtime config → UI payload (password masked) */
function toExternal(config) {
  return {
    schedule: { ...config.schedule },
    capture: {
      ...config.capture,
      maxImageMb: Math.round(config.capture.maxImageBytes / 1024 / 1024)
    },
    mail: {
      ...config.mail,
      pass: config.mail.pass ? PASS_MASK : '',
      hasPass: Boolean(config.mail.pass),
      maxAttachmentMb: Math.round(config.mail.maxAttachmentBytes / 1024 / 1024)
    },
    browser: { executablePath: config.browser.executablePath || '' },
    storage: { retentionDays: config.storage.retentionDays },
    sites: config.sites.map((s) => ({
      key: s.key,
      name: s.name,
      url: s.url,
      viewport: { ...s.viewport },
      userAgent: s.userAgent || '',
      fullPage: s.fullPage == null ? '' : s.fullPage,
      waitForSelector: s.waitForSelector || ''
    }))
  }
}

module.exports = { read, write, normalize, apply, toExternal, CONFIG_FILE, PASS_MASK }
