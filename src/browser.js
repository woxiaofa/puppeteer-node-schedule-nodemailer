'use strict'

const puppeteer = require('puppeteer')

const { withTimeout, retry } = require('./utils')

/** 浏览器是否已崩溃/断开 / whether the browser process is gone */
const isAlive = (browser) => Boolean(browser) && typeof browser.isConnected === 'function' && browser.isConnected()

/**
 * 浏览器会话：懒启动 + 断线自动重连 + 一定会释放进程。
 * Browser session: lazy launch, auto relaunch on disconnect, always releases the process.
 */
class BrowserSession {
  constructor({ browser: browserConfig, logger }) {
    this.config = browserConfig
    this.logger = logger
    this.browser = null
  }

  async launch() {
    const { launchTimeoutMs } = this.config
    return retry(
      async (attempt) => {
        this.logger.info(`启动浏览器（第 ${attempt} 次尝试）`)
        try {
          const browser = await withTimeout(
            puppeteer.launch({
              headless: this.config.headless,
              executablePath: this.config.executablePath,
              args: this.config.args,
              ignoreHTTPSErrors: true,
              protocolTimeout: launchTimeoutMs
            }),
            launchTimeoutMs,
            '浏览器启动超时 / browser launch timeout'
          )
          return browser
        } catch (err) {
          this.logger.warn(`浏览器启动失败：${err.message}`)
          throw err
        }
      },
      {
        times: 2,
        delayMs: 3000,
        onRetry: (err, attempt, wait) =>
          this.logger.warn(`浏览器启动失败(${err.message})，${wait}ms 后重试第 ${attempt + 1} 次`)
      }
    )
  }

  /** 获取可用浏览器，必要时重新拉起 / get a live browser, relaunch if needed */
  async get() {
    if (isAlive(this.browser)) return this.browser
    if (this.browser) this.logger.warn('浏览器已断开连接，准备重新启动')
    this.browser = await this.launch()
    return this.browser
  }

  async close() {
    const browser = this.browser
    this.browser = null
    if (!browser) return
    try {
      await withTimeout(browser.close(), 10000, '关闭浏览器超时 / browser close timeout')
    } catch (err) {
      this.logger.warn(`关闭浏览器异常：${err.message}`)
    } finally {
      // 兜底：进程仍在则强杀，避免僵尸 Chromium 占内存
      const proc = typeof browser.process === 'function' ? browser.process() : null
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL')
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
}

module.exports = { BrowserSession }
