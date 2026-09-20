'use strict'

const schedule = require('node-schedule')

/**
 * 调度器：负责 cron 注册、运行时去重、配置变更后的重新调度。
 * Scheduler: registers the cron job, prevents overlapping runs, supports rescheduling.
 */
class Scheduler {
  constructor({ config, logger, runner }) {
    this.config = config
    this.logger = logger
    this.runner = runner
    this.job = null
    this.running = false
    this.lastRunAt = null
  }

  /** （重新）注册定时任务 / (re)register the cron job */
  schedule() {
    const { cron, timezone } = this.config.schedule
    if (this.job) {
      this.job.cancel()
      this.job = null
    }
    try {
      this.job = schedule.scheduleJob({ rule: cron, tz: timezone }, () => {
        this.tick('cron')
      })
    } catch (err) {
      this.logger.error(`定时规则解析失败：${err.message}`)
      return false
    }
    if (!this.job) {
      this.logger.error(`定时规则无效：${cron}`)
      return false
    }
    const next = this.nextRun()
    this.logger.info(
      `定时任务已启动：cron="${cron}" 时区=${timezone}，下次执行 ${next ? next.toString() : '未知'}`
    )
    return true
  }

  /** 手动或定时触发一次 / trigger one run (manual or scheduled) */
  async tick(source = 'manual') {
    if (this.running) {
      this.logger.warn(`上一次任务尚未结束，本次(${source})触发已跳过`)
      return null
    }
    this.running = true
    this.lastRunAt = new Date().toISOString()
    try {
      return await this.runner({ source })
    } catch (err) {
      this.logger.error('任务执行异常：', err)
      throw err
    } finally {
      this.running = false
    }
  }

  nextRun() {
    try {
      return this.job ? this.job.nextInvocation() : null
    } catch (_) {
      return null
    }
  }

  stop() {
    if (this.job) this.job.cancel()
    this.job = null
  }
}

module.exports = { Scheduler }
