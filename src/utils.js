'use strict'

const fs = require('fs')
const path = require('path')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 给任意 Promise 套一个硬超时，避免某个操作把整个任务卡死。
 * Wrap a promise with a hard timeout so a hung operation cannot stall the run.
 */
async function withTimeout(promise, ms, message = 'operation timed out') {
  let timer
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} (timeout ${ms}ms)`)), ms)
  })
  try {
    return await Promise.race([promise, guard])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 指数退避重试：网络抖动 / 站点偶发 5xx 时自动再试。
 * Retry with exponential backoff for transient network/server errors.
 */
async function retry(fn, { times = 3, delayMs = 1000, factor = 2, onRetry } = {}) {
  let lastError
  for (let attempt = 1; attempt <= times; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      if (attempt >= times) break
      const wait = delayMs * Math.pow(factor, attempt - 1)
      if (onRetry) onRetry(err, attempt, wait)
      await sleep(wait)
    }
  }
  throw lastError
}

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true })

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 并发受限的 map：worker 抛错会被 Promise.all 冒泡，调用方需保证不抛 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/** 清理超过保留天数的历史目录 / Remove run folders older than retentionDays */
function cleanupOldDirs(rootDir, retentionDays, logger) {
  if (!retentionDays || retentionDays <= 0) return 0
  if (!fs.existsSync(rootDir)) return 0
  const deadline = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(rootDir, entry.name)
    let stat
    try {
      stat = fs.statSync(full)
    } catch (_) {
      continue
    }
    if (stat.mtimeMs < deadline) {
      fs.rmSync(full, { recursive: true, force: true })
      removed += 1
      logger && logger.info(`已清理过期目录 ${entry.name}`)
    }
  }
  return removed
}

const escapeHtml = (str) =>
  String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 时间戳：2026-09-20 / 2026-09-20_09-30-00 */
function stamp(date = new Date(), withTime = false) {
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return withTime ? `${day}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}` : day
}

module.exports = {
  sleep,
  withTimeout,
  retry,
  ensureDir,
  formatBytes,
  mapLimit,
  cleanupOldDirs,
  escapeHtml,
  stamp
}
