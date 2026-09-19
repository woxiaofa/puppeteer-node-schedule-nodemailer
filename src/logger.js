'use strict'

const fs = require('fs')
const path = require('path')

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

/**
 * 极简分级日志：控制台输出 + 可选落盘，写文件失败不影响主流程。
 * Minimal leveled logger: console output with optional file sink (best effort).
 */
class Logger {
  constructor({ level = 'info', file = null, prefix = '' } = {}) {
    this.levelName = String(level).toLowerCase()
    this.threshold = LEVELS[this.levelName] != null ? LEVELS[this.levelName] : LEVELS.info
    this.file = file
    this.prefix = prefix
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
      } catch (_) {
        /* ignore */
      }
    }
  }

  _write(level, args) {
    if (LEVELS[level] < this.threshold) return
    const ts = new Date().toISOString()
    const msg = args
      .map((a) => {
        if (a instanceof Error) return a.stack || a.message
        if (typeof a === 'object') {
          try {
            return JSON.stringify(a)
          } catch (_) {
            return String(a)
          }
        }
        return String(a)
      })
      .join(' ')
    const line = `${ts} [${level.toUpperCase()}]${this.prefix ? ` ${this.prefix}` : ''} ${msg}`
    if (level === 'error' || level === 'warn') console.error(line)
    else console.log(line)

    if (this.file) {
      try {
        fs.appendFileSync(this.file, line + '\n')
      } catch (_) {
        /* 日志失败不能拖垮任务 */
      }
    }
  }

  debug(...args) {
    this._write('debug', args)
  }
  info(...args) {
    this._write('info', args)
  }
  warn(...args) {
    this._write('warn', args)
  }
  error(...args) {
    this._write('error', args)
  }

  /** 带固定前缀的子日志器，便于区分不同站点 / Child logger with a fixed prefix */
  child(prefix) {
    return new Logger({ level: this.levelName, file: this.file, prefix })
  }
}

module.exports = { Logger, createLogger: (opts) => new Logger(opts) }
