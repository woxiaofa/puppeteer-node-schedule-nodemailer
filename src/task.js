'use strict'

const fs = require('fs')
const path = require('path')

const { BrowserSession } = require('./browser')
const { captureAll } = require('./capture')
const { sendReport } = require('./mailer')
const { ensureDir, cleanupOldDirs, stamp } = require('./utils')

const failedResult = (site, error) => ({
  key: site.key,
  name: site.name,
  url: site.url,
  viewport: `${site.viewport.width}x${site.viewport.height}`,
  ok: false,
  status: null,
  file: null,
  size: 0,
  error,
  warnings: [],
  attempts: 0,
  durationMs: 0
})

/**
 * 执行一次完整任务：截图 -> 写报告 -> 发邮件 -> 清理历史。
 * 任何一步失败都不会影响其它步骤：截图失败仍然发“失败报告”，
 * 发信失败仍然把截图留在磁盘上。
 * Run once: capture -> write report -> send mail -> cleanup.
 * Failures are isolated: capture failures still produce a report,
 * mail failures still leave screenshots on disk.
 */
async function runOnce({ config, logger, options = {} }) {
  const startedAt = new Date()
  const dayText = stamp(startedAt)
  const runDir = path.join(config.storage.outputDir, stamp(startedAt, true))
  ensureDir(runDir)

  const session = new BrowserSession({ browser: config.browser, logger })
  let results
  try {
    // 预检浏览器：起不来就没必要逐个站点重试，直接全部记失败
    await session.get()
    results = await captureAll(session, config.sites, { capture: config.capture, outputDir: runDir }, logger)
  } catch (err) {
    // 走到这里说明浏览器彻底起不来等致命错误：全部记为失败，但流程继续
    logger.error(`截图流程异常：${err.message}`)
    results = config.sites.map((site) => failedResult(site, err.message))
  } finally {
    await session.close()
  }

  const finishedAt = new Date()
  const succeeded = results.filter((r) => r.ok).length
  const summary = {
    title: config.mail.subjectPrefix,
    dayText,
    runDir,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    finishedAtText: finishedAt.toLocaleString('zh-CN', { hour12: false, timeZone: config.schedule.timezone }),
    durationMs: finishedAt - startedAt,
    reportFile: path.join(runDir, 'report.txt'),
    mail: { enabled: config.mail.enabled && !options.dryRun, error: null }
  }

  // 报告落盘：既是历史记录，也是邮件兜底内容
  try {
    fs.writeFileSync(summary.reportFile, require('./mailer').buildText(summary), 'utf8')
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  } catch (err) {
    logger.warn(`报告写入失败：${err.message}`)
  }

  if (!config.mail.enabled) {
    logger.warn('邮件未配置，跳过发送（截图已保存到本地）')
  } else if (options.dryRun) {
    logger.info('演练模式（--dry-run / --no-mail），不发邮件')
  } else {
    try {
      await sendReport({ config, summary, logger })
    } catch (err) {
      summary.mail.error = err.message
      logger.error(`邮件发送失败：${err.message}（截图仍保留在 ${runDir}）`)
    }
  }

  const removed = cleanupOldDirs(config.storage.outputDir, config.storage.retentionDays, logger)
  if (removed) logger.info(`已清理 ${removed} 个过期目录`)

  return summary
}

module.exports = { runOnce }
