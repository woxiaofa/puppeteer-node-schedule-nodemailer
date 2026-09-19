'use strict'

const fs = require('fs')
const path = require('path')

const { sleep, retry, mapLimit } = require('./utils')

/** 缓慢滚动一遍页面，触发图片懒加载，避免整页截图一片空白 */
async function autoScroll(page, { maxSteps = 20, stepDelayMs = 250 } = {}) {
  try {
    await page.evaluate(
      async (steps, delay) => {
        await new Promise((resolve) => {
          let step = 0
          const timer = setInterval(() => {
            window.scrollBy(0, window.innerHeight)
            step += 1
            if (step >= steps || window.scrollY + window.innerHeight >= document.body.scrollHeight) {
              clearInterval(timer)
              window.scrollTo(0, 0)
              resolve()
            }
          }, delay)
        })
      },
      maxSteps,
      stepDelayMs
    )
  } catch (_) {
    /* 滚动失败不影响截图 */
  }
}

/** 页面正文长度，用于识别“白屏/未渲染完” */
async function contentLength(page) {
  try {
    return await page.evaluate(() => {
      const body = document.body || {}
      const text = body.innerText || body.textContent || ''
      return String(text).trim().length
    })
  } catch (_) {
    return -1
  }
}

/**
 * 单个站点的真实截图动作（失败会抛错，由上层重试）。
 * One capture attempt; throws on failure so the caller can retry.
 */
async function shoot(session, site, options, log, result) {
  const { capture, outputDir } = options
  const browser = await session.get()
  const page = await browser.newPage()
  const file = path.join(outputDir, `${site.key}.png`)

  try {
    await page.setViewport({
      width: site.viewport.width,
      height: site.viewport.height,
      deviceScaleFactor: 1
    })
    if (site.userAgent) await page.setUserAgent(site.userAgent)
    page.setDefaultTimeout(capture.navigationTimeoutMs)
    page.setDefaultNavigationTimeout(capture.navigationTimeoutMs)

    const response = await page.goto(site.url, {
      waitUntil: capture.waitUntil,
      timeout: capture.navigationTimeoutMs
    })

    const status = response ? response.status() : 0
    result.status = status
    if (!response) throw new Error('没有收到响应（可能是 DNS / 连接失败）')
    if (status >= 400) throw new Error(`HTTP ${status}`)

    if (site.waitForSelector) {
      await page.waitForSelector(site.waitForSelector, { timeout: capture.navigationTimeoutMs })
    }

    await sleep(capture.extraWaitMs)

    const fullPage = site.fullPage == null ? capture.fullPage : Boolean(site.fullPage)

    if (fullPage && capture.autoScroll) await autoScroll(page)

    // 空白检测：文本过短说明页面还没渲染完（SPA 常见），多等 3 秒再看
    let textLen = await contentLength(page)
    if (textLen >= 0 && textLen < capture.minContentLength) {
      log.warn(`页面内容疑似空白（${textLen} 字符），额外等待 3s 后重试渲染`)
      await sleep(3000)
      textLen = await contentLength(page)
      if (textLen < capture.minContentLength) {
        result.warnings.push(`页面内容偏少（${textLen} 字符），可能是空白页或未渲染完成`)
      }
    }

    try {
      await page.screenshot({ path: file, type: 'png', fullPage })
    } catch (err) {
      if (!fullPage) throw err
      // 整页过大 / 高度超限：降级为首屏截图
      log.warn(`整页截图失败（${err.message}），降级为首屏截图`)
      result.warnings.push('整页截图失败，已降级为首屏')
      await page.screenshot({ path: file, type: 'png', fullPage: false })
    }

    const stat = fs.statSync(file)
    if (stat.size > capture.maxImageBytes && fullPage) {
      log.warn(`截图 ${Math.round(stat.size / 1024 / 1024)}MB 超过上限，降级为首屏`)
      await page.screenshot({ path: file, type: 'png', fullPage: false })
      result.warnings.push('整页截图体积超限，已降级为首屏')
    }

    result.file = file
    result.size = fs.statSync(file).size
  } finally {
    // 无论成功失败都关页面，防止 tab 泄漏
    await page.close().catch(() => {})
  }
}

/** 截图单个站点：含重试、降级、失败兜底（永不抛错） */
async function captureSite(session, site, options, logger) {
  const log = logger.child(`[${site.key}]`)
  const startedAt = Date.now()
  const result = {
    key: site.key,
    name: site.name,
    url: site.url,
    viewport: `${site.viewport.width}x${site.viewport.height}`,
    ok: false,
    status: null,
    file: null,
    size: 0,
    error: null,
    warnings: [],
    attempts: 0,
    durationMs: 0
  }

  try {
    await retry((attempt) => shoot(session, site, options, log, result), {
      times: Math.max(1, options.capture.retries + 1),
      delayMs: options.capture.retryDelayMs,
      onRetry: (err, attempt, wait) =>
        log.warn(`第 ${attempt} 次截图失败：${err.message}，${wait}ms 后重试`)
    })
    result.ok = true
    result.attempts = result.attempts || 1
    log.info(`截图成功 ${(result.size / 1024).toFixed(0)}KB，耗时 ${Date.now() - startedAt}ms`)
  } catch (err) {
    result.error = err.message
    log.error(`截图失败：${err.message}（已尝试 ${Math.max(1, options.capture.retries + 1)} 次）`)
    // 清理可能的半成品文件，避免邮件里出现坏图
    if (result.file) {
      try {
        fs.rmSync(result.file, { force: true })
      } catch (_) {
        /* ignore */
      }
      result.file = null
    }
  }

  result.attempts = result.attempts || options.capture.retries + 1
  result.durationMs = Date.now() - startedAt
  return result
}

/** 并发截图全部站点 / capture all sites with limited concurrency */
async function captureAll(session, sites, options, logger) {
  logger.info(`开始截图：${sites.length} 个站点，并发 ${options.capture.concurrency}`)
  const results = await mapLimit(sites, options.capture.concurrency, (site) =>
    captureSite(session, site, options, logger)
  )
  const ok = results.filter((r) => r.ok).length
  logger.info(`截图结束：成功 ${ok} / 共 ${results.length}`)
  return results
}

module.exports = { captureAll, captureSite, autoScroll }
