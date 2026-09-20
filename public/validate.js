/**
 * 前后端共用的表单校验规则（UMD：Node 里 require，浏览器里挂到 window.SiteShotRules）。
 * Shared validation rules used by both the server (store.normalize) and the browser UI.
 *
 * field 命名约定：与界面 input 的 id 一致；站点类字段为 sites.<索引>.<字段>。
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module && module.exports) module.exports = api
  else root.SiteShotRules = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

  const text = (v) => String(v == null ? '' : v).trim()
  const isEmail = (v) => EMAIL_RE.test(text(v))
  const isAddress = (v) => {
    const val = text(v)
    if (!val) return false
    const angle = val.match(/<([^>]+)>\s*$/)
    return isEmail(angle ? angle[1] : val)
  }
  const toList = (v) =>
    Array.isArray(v)
      ? v.map((x) => text(x)).filter(Boolean)
      : text(v)
          .split(/[,;\n]+/)
          .map((x) => x.trim())
          .filter(Boolean)
  const invalidAddresses = (v) => toList(v).filter((x) => !isEmail(x))
  const isInt = (v, min, max) => {
    const n = Number(v)
    return Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max
  }
  const isValidTimeZone = (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: text(tz) })
      return !!tz
    } catch (_) {
      return false
    }
  }
  const isValidCron = (v) => /^(\S+\s+){4}\S+$/.test(text(v))
  const isValidUrl = (v) => {
    try {
      const url = new URL(text(v))
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch (_) {
      return false
    }
  }
  const isHostname = (v) => HOST_RE.test(text(v)) && !/:\/\//.test(text(v))

  /**
   * 校验界面提交的完整配置。
   * errors: [{ field, message }]
   */
  function validateExternal(payload, options = {}) {
    const p = payload || {}
    const sch = p.schedule || {}
    const cap = p.capture || {}
    const mail = p.mail || {}
    const storage = p.storage || {}
    const errors = []
    const add = (field, message) => errors.push({ field, message })

    /* ---------- 定时 ---------- */
    if (!isValidCron(sch.cron)) add('cron', 'cron 必须为 5 段格式：分 时 日 月 周，例如 30 9 * * *')
    if (!isValidTimeZone(sch.timezone)) add('timezone', '时区无效，请使用 IANA 时区，例如 Asia/Shanghai')

    /* ---------- 截图参数 ---------- */
    if (!isInt(cap.concurrency, 1, 8)) add('concurrency', '并发页面数需为 1~8 的整数')
    if (!isInt(cap.navigationTimeoutMs, 3000, 180000)) add('navigationTimeoutMs', '导航超时需为 3000~180000 毫秒')
    if (!isInt(cap.extraWaitMs, 0, 30000)) add('extraWaitMs', '额外等待需为 0~30000 毫秒')
    if (!isInt(cap.retries, 0, 5)) add('retries', '失败重试次数需为 0~5 的整数')
    if (!isInt(cap.maxImageMb, 1, 50)) add('maxImageMb', '单图上限需为 1~50 MB')
    if (!isInt(storage.retentionDays, 0, 365)) add('retentionDays', '历史保留天数需为 0~365 的整数')

    /* ---------- 邮件（邮箱字段强制邮箱格式） ---------- */
    const to = toList(mail.to)
    const cc = toList(mail.cc)
    const mailTouched = Boolean(text(mail.host) || text(mail.user) || text(mail.pass) || to.length || cc.length)

    if (mailTouched) {
      if (!text(mail.host)) add('smtpHost', 'SMTP 服务器不能为空，例如 smtp.qq.com')
      else if (!isHostname(mail.host)) add('smtpHost', 'SMTP 服务器请填主机名（如 smtp.qq.com），不要带 http:// 或端口')

      if (!isInt(mail.port, 1, 65535)) add('smtpPort', '端口需为 1~65535 的整数（QQ/163 常用 465，Office365 常用 587）')

      if (!text(mail.user)) add('smtpUser', 'SMTP 账号必须填写邮箱地址，例如 your@email.com')
      else if (!isEmail(mail.user)) add('smtpUser', 'SMTP 账号不是合法的邮箱地址，例如 your@email.com')

      if (!to.length) add('mailTo', '收件人不能为空，请填写至少一个邮箱地址，例如 someone@example.com')
      const badTo = invalidAddresses(to)
      if (badTo.length) add('mailTo', `收件人不是合法邮箱地址：${badTo.join('、')}`)

      if (text(mail.from) && !isAddress(mail.from)) {
        add('mailFrom', '发件人需为邮箱或「名称 <邮箱>」格式，例如 site-shot <your@email.com>')
      }
      if (mailTouched && !options.hasSavedPass && !text(mail.pass)) {
        add('smtpPass', '请填写密码／授权码（QQ、163、Gmail 需用授权码而非登录密码）')
      }
    }
    const badCc = invalidAddresses(cc)
    if (badCc.length) add('mailCc', `抄送不是合法邮箱地址：${badCc.join('、')}`)
    if (text(mail.subjectPrefix).length > 60) add('subjectPrefix', '标题前缀不能超过 60 个字符')
    if (mail.maxAttachmentMb != null && text(mail.maxAttachmentMb) !== '' && !isInt(mail.maxAttachmentMb, 1, 50)) {
      add('maxAttachmentMb', '附件上限需为 1~50 MB')
    }

    /* ---------- 站点 ---------- */
    const sites = Array.isArray(p.sites) ? p.sites : []
    if (!sites.length) add('site-rows', '至少需要配置一个截图站点')

    const seenKeys = new Set()
    sites.forEach((site, index) => {
      const s = site || {}
      const url = text(s.url)
      const name = text(s.name)
      if (!url) add(`sites.${index}.url`, 'URL 不能为空')
      else if (!isValidUrl(url)) add(`sites.${index}.url`, 'URL 必须以 http:// 或 https:// 开头，且包含域名')

      if (!name) add(`sites.${index}.name`, '名称不能为空')

      const width = s.viewport && s.viewport.width
      const height = s.viewport && s.viewport.height
      if (!isInt(width, 320, 3840)) add(`sites.${index}.viewportWidth`, '宽度需为 320~3840 的整数')
      if (!isInt(height, 320, 4320)) add(`sites.${index}.viewportHeight`, '高度需为 320~4320 的整数')

      const key = text(s.key)
      if (key) {
        if (!/^[a-zA-Z0-9_-]+$/.test(key)) add(`sites.${index}.key`, '标识只能包含字母、数字、下划线和短横线')
        else if (seenKeys.has(key)) add(`sites.${index}.key`, `标识重复：${key}`)
        else seenKeys.add(key)
      }
    })

    return errors
  }

  return {
    EMAIL_RE,
    validateExternal,
    isEmail,
    isAddress,
    invalidAddresses,
    isValidTimeZone,
    isValidCron,
    isValidUrl,
    isHostname,
    isInt,
    toList
  }
})
