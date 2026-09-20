#!/usr/bin/env node
'use strict'

const path = require('path')
const express = require('express')

const { config, validate, ROOT } = require('../config')
const { createLogger } = require('./logger')
const { runOnce } = require('./task')
const { Scheduler } = require('./scheduler')
const { sendTestMail } = require('./mailer')
const { diagnose, render } = require('./diagnose')
const { tailLines, sleep } = require('./utils')
const store = require('./store')
const { listRuns, readRun, runFilePath } = require('./history')

/** 可选的基础认证：设置了 WEB_USER 才启用 */
function authMiddleware(webConfig) {
  return (req, res, next) => {
    const header = req.headers.authorization || ''
    const [type, token] = header.split(' ')
    if (type === 'Basic' && token) {
      const decoded = Buffer.from(token, 'base64').toString('utf8')
      const idx = decoded.indexOf(':')
      const user = decoded.slice(0, idx)
      const pass = decoded.slice(idx + 1)
      if (user === webConfig.user && pass === webConfig.pass) return next()
    }
    res.set('WWW-Authenticate', 'Basic realm="site-shot"')
    res.status(401).send('需要认证 / authentication required')
  }
}

function createApp({ config, logger, scheduler, state }) {
  const app = express()
  app.use(express.json({ limit: '2mb' }))
  if (config.web.user) app.use(authMiddleware(config.web))
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }))

  app.get('/api/status', (req, res) => {
    res.json({
      running: scheduler.running,
      nextRun: scheduler.nextRun(),
      lastRunAt: scheduler.lastRunAt,
      lastRun: state.lastRun,
      mailEnabled: config.mail.enabled,
      cron: config.schedule.cron,
      timezone: config.schedule.timezone,
      configFile: path.relative(ROOT, store.CONFIG_FILE),
      outputDir: path.relative(ROOT, config.storage.outputDir),
      siteCount: config.sites.length
    })
  })

  app.get('/api/config', (req, res) => {
    res.json({ config: store.toExternal(config), warnings: validate(config).warnings })
  })

  app.put('/api/config', (req, res) => {
    const { user, errors } = store.normalize(req.body, config)
    if (errors.length) return res.status(400).json({ ok: false, errors })
    store.apply(config, user)
    store.write(user)
    const { warnings } = validate(config)
    const scheduled = scheduler.schedule()
    logger.info('配置已更新，调度已重新加载')
    res.json({ ok: true, warnings, scheduled, nextRun: scheduler.nextRun() })
  })

  app.post('/api/run', (req, res) => {
    if (scheduler.running) {
      return res.status(409).json({ ok: false, message: '已有任务正在执行中 / a run is already in progress' })
    }
    scheduler
      .tick('manual')
      .then((summary) => {
        state.lastRun = {
          id: path.basename(summary.runDir),
          succeeded: summary.succeeded,
          total: summary.total,
          failed: summary.failed,
          finishedAtText: summary.finishedAtText,
          mailError: summary.mail.error
        }
      })
      .catch((err) => logger.error(`手动执行失败：${err.message}`))
    res.status(202).json({ ok: true, message: '已在后台开始执行 / started in background' })
  })

  app.post('/api/test-mail', async (req, res) => {
    try {
      const info = await sendTestMail({ config, logger })
      res.json({ ok: true, message: `测试邮件已发送给 ${config.mail.to.join(', ')}`, response: info.response })
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message, code: err.code || '' })
    }
  })

  // SMTP 逐层自检：DNS → 端口连通 → SMTP 握手 → 登录
  app.post('/api/mail/diagnose', async (req, res) => {
    try {
      const result = await diagnose({ mail: config.mail, timeoutMs: 12000 })
      res.json({ ok: result.reports.some((r) => r.ok), report: render(result) })
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message })
    }
  })

  app.get('/api/history', (req, res) => {
    res.json({ runs: listRuns(config.storage.outputDir, 50) })
  })

  app.get('/api/history/:id', (req, res) => {
    const run = readRun(config.storage.outputDir, req.params.id)
    if (!run) return res.status(404).json({ ok: false, message: 'not found' })
    res.json(run)
  })

  app.get('/api/history/:id/file/:name', (req, res) => {
    const file = runFilePath(config.storage.outputDir, req.params.id, req.params.name)
    if (!file) return res.status(404).end('not found')
    res.sendFile(file)
  })

  app.get('/api/logs', (req, res) => {
    const lines = Math.min(Number(req.query.lines) || 200, 2000)
    res.json({ file: config.log.file, lines: tailLines(config.log.file, lines) })
  })

  app.use((err, req, res, next) => {
    logger.error('API 异常：', err)
    res.status(500).json({ ok: false, message: err.message })
  })

  return app
}

/** 启动 Web 界面（同时承载定时调度） */
function startWeb({ withSchedule = true } = {}) {
  const logger = createLogger({ level: config.log.level, file: config.log.file })

  process.on('unhandledRejection', (err) => logger.error('未处理的 Promise 拒绝：', err))
  process.on('uncaughtException', (err) => logger.error('未捕获异常：', err))

  const { errors, warnings } = validate(config)
  warnings.forEach((w) => logger.warn(w))
  errors.forEach((e) => logger.error(e))

  const state = { lastRun: null }
  const scheduler = new Scheduler({
    config,
    logger,
    runner: async () => {
      const summary = await runOnce({ config, logger, options: {} })
      state.lastRun = {
        id: path.basename(summary.runDir),
        succeeded: summary.succeeded,
        total: summary.total,
        failed: summary.failed,
        finishedAtText: summary.finishedAtText,
        mailError: summary.mail.error
      }
      return summary
    }
  })

  if (withSchedule && !errors.length) {
    scheduler.schedule()
    if (config.schedule.runOnStart) scheduler.tick('start')
  }

  const app = createApp({ config, logger, scheduler, state })
  const server = app.listen(config.web.port, config.web.host, () => {
    logger.info(`Web 界面已启动：http://${config.web.host}:${config.web.port}`)
    console.log(`\n  site-shot 控制台 / dashboard: http://${config.web.host}:${config.web.port}\n`)
  })

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`收到 ${signal}，正在关闭服务...`)
    scheduler.stop()
    server.close()
    const deadline = Date.now() + 30000
    while (scheduler.running && Date.now() < deadline) await sleep(500)
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  return { app, server, scheduler, config, logger }
}

module.exports = { createApp, startWeb }

if (require.main === module) startWeb()
