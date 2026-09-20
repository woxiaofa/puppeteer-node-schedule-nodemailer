#!/usr/bin/env node
'use strict'

const { config, validate } = require('../config')
const { createLogger } = require('./logger')
const { runOnce } = require('./task')
const { Scheduler } = require('./scheduler')
const { sleep } = require('./utils')

const USAGE = `
site-shot - 定时截图 + 邮件报告 / scheduled screenshots + email report

  node src/index.js            按 SCHEDULE_CRON 常驻定时执行 / run as daemon
  node src/index.js --once     立即执行一次后退出（配合系统 crontab）/ run once and exit
  node src/index.js --dry-run  只截图不发送邮件（调试）/ capture, no email
  node src/index.js --check    仅校验配置后退出 / validate config only
  node src/index.js --help     查看帮助 / help

  node src/server.js           启动 Web 控制台（可在界面里配置邮箱/站点/定时任务）
                               start the web dashboard (configure mail/sites/schedule in UI)

环境变量见 .env.example / see .env.example for all environment variables
`

function parseArgs(argv) {
  const args = { once: false, dryRun: false, check: false, help: false }
  for (const arg of argv) {
    switch (arg) {
      case '--once':
      case '-1':
        args.once = true
        break
      case '--dry-run':
      case '--no-mail':
        args.dryRun = true
        break
      case '--check':
        args.check = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        console.warn(`忽略未知参数：${arg}`)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return 0
  }

  const logger = createLogger({ level: config.log.level, file: config.log.file })

  // 常驻进程不能被一个未捕获异常打挂
  process.on('unhandledRejection', (err) => logger.error('未处理的 Promise 拒绝：', err))
  process.on('uncaughtException', (err) => logger.error('未捕获异常：', err))

  const { errors, warnings } = validate(config)
  warnings.forEach((w) => logger.warn(w))
  if (errors.length) {
    errors.forEach((e) => logger.error(e))
    return 1
  }
  if (args.check) {
    logger.info(
      `配置校验通过：${config.sites.length} 个站点，cron="${config.schedule.cron}"，邮件=${
        config.mail.enabled ? '开启' : '关闭'
      }`
    )
    return 0
  }

  let lastSummary = null
  const scheduler = new Scheduler({
    config,
    logger,
    runner: async () => {
      const summary = await runOnce({ config, logger, options: { dryRun: args.dryRun } })
      lastSummary = summary
      logger.info(`任务完成：成功 ${summary.succeeded}/${summary.total}，输出目录 ${summary.runDir}`)
      if (summary.mail.error) {
        logger.error(`邮件未发出：${summary.mail.error}（截图仍在 ${summary.runDir}）`)
      }
      return summary
    }
  })

  if (args.once) {
    await scheduler.tick('once')
    // 退出码：全部成功为 0，否则为 1，方便 crontab / 监控告警识别
    return lastSummary && lastSummary.succeeded === lastSummary.total ? 0 : 1
  }

  if (!scheduler.schedule()) return 1

  if (config.schedule.runOnStart) {
    logger.info('RUN_ON_START=true，先立即执行一次')
    await scheduler.tick('start')
  }

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`收到 ${signal}，等待当前任务结束后退出...`)
    scheduler.stop()
    const deadline = Date.now() + 30000
    while (scheduler.running && Date.now() < deadline) await sleep(500)
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  return null // 常驻，不退出
}

main()
  .then((code) => {
    if (code !== null) process.exit(code)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
