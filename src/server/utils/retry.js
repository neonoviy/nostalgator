const logger = require('./logger')

const SQLITE_LOCK_MESSAGES = [
  'database is locked',
  'database, disk I/O error',
  'Operations timed out',
  'busy_timeout',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_IOERR',
]

const isSqliteLockError = (err) => {
  if (!err) return false
  const msg = (err.message || '').toLowerCase()
  return SQLITE_LOCK_MESSAGES.some((m) => msg.includes(m.toLowerCase()))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const withRetry = async (fn, options = {}) => {
  const maxAttempts = options.maxAttempts || 3
  const baseDelay = options.baseDelay || 500
  const factor = options.factor || 2
  const logger_ = options.logger || logger

  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isSqliteLockError(err)) {
        throw err
      }
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(factor, attempt - 1)
        logger_.warn(
          `SQLite lock error (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms: ${err.message}`,
        )
        await sleep(delay)
      }
    }
  }

  throw lastError
}

module.exports = { withRetry, isSqliteLockError }
