'use strict'

const fs = require('fs')
const path = require('path')

/** 运行历史：直接读取 screenshots/日期_时间/summary.json */
function listRuns(outputDir, limit = 30) {
  if (!fs.existsSync(outputDir)) return []
  return fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse()
    .slice(0, limit)
    .map((id) => {
      const dir = path.join(outputDir, id)
      const summaryFile = path.join(dir, 'summary.json')
      if (fs.existsSync(summaryFile)) {
        try {
          const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'))
          return {
            id,
            finishedAtText: summary.finishedAtText || id,
            total: summary.total,
            succeeded: summary.succeeded,
            failed: summary.failed,
            durationMs: summary.durationMs,
            mailError: summary.mail && summary.mail.error
          }
        } catch (_) {
          /* fallthrough */
        }
      }
      let mtime = null
      try {
        mtime = fs.statSync(dir).mtime.toISOString()
      } catch (_) {
        /* ignore */
      }
      return { id, finishedAtText: id, total: 0, succeeded: 0, failed: 0, durationMs: 0, mtime }
    })
}

function readRun(outputDir, id) {
  const file = path.join(outputDir, path.basename(id), 'summary.json')
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    return null
  }
}

/** 只允许访问运行目录内的文件，防目录穿越 */
function runFilePath(outputDir, id, name) {
  const dir = path.join(outputDir, path.basename(id))
  const file = path.join(dir, path.basename(name))
  if (!file.startsWith(dir) || !fs.existsSync(file)) return null
  return file
}

module.exports = { listRuns, readRun, runFilePath }
