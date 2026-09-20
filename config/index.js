'use strict'

require('dotenv').config()

const fs = require('fs')
const path = require('path')

const { invalidAddresses, isAddress, isEmail, isValidTimeZone, isValidCron, isValidUrl, isInt } = require('../src/utils')

const ROOT = path.resolve(__dirname, '..')

const toNum = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const toBool = (value, fallback) => {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}
const toList = (value) =>
  String(value || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * 站点清单：优先使用 git 忽略的 sites.local.js
 * Site list: prefer the git-ignored sites.local.js when present.
 */
function loadSites() {
  const local = path.join(__dirname, 'sites.local.js')
  const file = fs.existsSync(local) ? local : path.join(__dirname, 'sites.js')
  const sites = require(file)
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error(`站点配置为空，请检查 ${file} / site list is empty: ${file}`)
  }
  return sites.map((site, index) => {
    if (!site || !site.url || !site.key) {
      throw new Error(`站点配置第 ${index + 1} 项缺少 key 或 url / site #${index + 1} missing key or url`)
    }
    return {
      name: site.name || site.key,
      fullPage: undefined,
      waitForSelector: null,
      ...site,
      viewport: {
        width: toNum(site.viewport && site.viewport.width, 1600),
        height: toNum(site.viewport && site.viewport.height, 900)
      }
    }
  })
}

const port = toNum(process.env.SMTP_PORT, 465)

/** 完整配置：全部可用环境变量覆盖，见 .env.example */
const config = {
  root: ROOT,
  schedule: {
    cron: process.env.SCHEDULE_CRON || '30 9 * * *',
    timezone: process.env.SCHEDULE_TIMEZONE || 'Asia/Shanghai',
    runOnStart: toBool(process.env.RUN_ON_START, false)
  },
  browser: {
    headless: toBool(process.env.HEADLESS, true) ? true : false,
    executablePath: process.env.CHROME_PATH || undefined,
    launchTimeoutMs: toNum(process.env.BROWSER_LAUNCH_TIMEOUT, 60000),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  },
  capture: {
    concurrency: toNum(process.env.MAX_CONCURRENCY, 2),
    navigationTimeoutMs: toNum(process.env.NAVIGATION_TIMEOUT, 30000),
    waitUntil: process.env.WAIT_UNTIL || 'networkidle2',
    extraWaitMs: toNum(process.env.EXTRA_WAIT, 1500),
    fullPage: toBool(process.env.FULL_PAGE, true),
    retries: toNum(process.env.CAPTURE_RETRIES, 2),
    retryDelayMs: toNum(process.env.CAPTURE_RETRY_DELAY, 3000),
    maxImageBytes: toNum(process.env.MAX_IMAGE_MB, 10) * 1024 * 1024,
    // 页面文本少于该字符数时判定为“疑似空白”，多等一会儿再截
    minContentLength: toNum(process.env.MIN_CONTENT_LENGTH, 50),
    autoScroll: toBool(process.env.AUTO_SCROLL, true)
  },
  storage: {
    outputDir: path.resolve(ROOT, process.env.SCREENSHOT_DIR || 'screenshots'),
    retentionDays: toNum(process.env.RETENTION_DAYS, 7)
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port,
    secure: process.env.SMTP_SECURE ? toBool(process.env.SMTP_SECURE, false) : port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
    to: toList(process.env.MAIL_TO),
    cc: toList(process.env.MAIL_CC),
    subjectPrefix: process.env.MAIL_SUBJECT_PREFIX || '网站截图日报',
    maxAttachmentBytes: toNum(process.env.MAX_ATTACHMENT_MB, 15) * 1024 * 1024,
    retries: toNum(process.env.MAIL_RETRIES, 3),
    timeoutMs: toNum(process.env.SMTP_TIMEOUT, 20000)
  },
  web: {
    port: toNum(process.env.WEB_PORT, 3000),
    host: process.env.WEB_HOST || '127.0.0.1',
    // 设置了 WEB_USER 才会开启基础认证（建议公网部署时开启）
    user: process.env.WEB_USER || '',
    pass: process.env.WEB_PASS || ''
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE === '' ? null : path.resolve(ROOT, process.env.LOG_FILE || 'logs/run.log')
  },
  sites: loadSites()
}

/** 邮件开启条件：SMTP 与收件人都配置齐全 / mail works only when fully configured */
config.mail.enabled = Boolean(config.mail.host && config.mail.user && config.mail.pass && config.mail.to.length > 0)

/**
 * 启动前校验：errors 会终止程序，warnings 只提示。
 * Pre-flight validation: errors abort, warnings only inform.
 */
function validate(cfg = config) {
  const { errors, warnings } = { errors: [], warnings: [] }

  if (!isValidCron(cfg.schedule.cron)) {
    errors.push(`SCHEDULE_CRON 不是合法的 5 段 cron 表达式：${cfg.schedule.cron}`)
  }
  if (!isValidTimeZone(cfg.schedule.timezone)) {
    errors.push(`SCHEDULE_TIMEZONE 不是合法时区：${cfg.schedule.timezone}（例如 Asia/Shanghai）`)
  }

  cfg.sites.forEach((site, index) => {
    const label = `站点 #${index + 1} ${site.key || ''}`.trim()
    if (!isValidUrl(site.url)) errors.push(`${label}：URL 必须以 http:// 或 https:// 开头且包含域名（${site.url}）`)
    if (!isInt(site.viewport.width, 320, 3840)) errors.push(`${label}：视口宽度需在 320~3840（${site.viewport.width}）`)
    if (!isInt(site.viewport.height, 320, 4320)) errors.push(`${label}：视口高度需在 320~4320（${site.viewport.height}）`)
  })
  if (!cfg.sites.length) errors.push('没有配置任何截图站点')

  if (!cfg.mail.enabled) {
    warnings.push(
      '邮件未配置（SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_TO 不完整），将只保存截图到本地，不发送邮件。' +
        'Mail not configured: screenshots will be saved locally only.'
    )
  }
  if (cfg.mail.enabled && !cfg.mail.from) {
    errors.push('缺少 MAIL_FROM 发件人')
  }
  for (const bad of invalidAddresses(cfg.mail.to)) errors.push(`收件人不是合法邮箱地址：${bad}（MAIL_TO）`)
  for (const bad of invalidAddresses(cfg.mail.cc)) errors.push(`抄送不是合法邮箱地址：${bad}（MAIL_CC）`)
  if (cfg.mail.from && !isAddress(cfg.mail.from)) errors.push(`发件人不是合法邮箱地址：${cfg.mail.from}（MAIL_FROM）`)
  if (cfg.mail.user && !isEmail(cfg.mail.user)) errors.push(`SMTP 账号应填写完整邮箱地址：${cfg.mail.user}（SMTP_USER）`)
  if (!cfg.mail.enabled && cfg.mail.user && cfg.mail.pass && !cfg.mail.to.length) {
    warnings.push('已配置 SMTP 账号但没有收件人（MAIL_TO / 界面「收件人」），当前只截图不发邮件。')
  }

  if (cfg.mail.enabled && !/^smtp[.-]/i.test(cfg.mail.host)) {
    warnings.push(
      `SMTP_HOST="${cfg.mail.host}" 不像标准 SMTP 地址（通常形如 smtp.qq.com / smtp.exmail.qq.com）；` +
        '地址写错时最常见的表现就是「SMTP 连接/登录超时」。' +
        'Host does not look like an SMTP hostname; wrong host usually surfaces as a connection timeout.'
    )
  }
  return { errors, warnings }
}

// 界面保存的配置（data/config.json）优先级高于环境变量
// Config saved from the web UI (data/config.json) takes precedence over env vars
const store = require('../src/store')
store.apply(config, store.read())

module.exports = { config, validate, ROOT, store }
