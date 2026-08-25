/**
 * Pretty logging utility
 * Uses ANSI colors and emoji for server console.
 * The entire message is colored by category — easy to distinguish from third-party logs.
 * Also supports forwarding messages to the web interface.
 */

const COLORS = {
  Reset: '\x1b[0m',
  FgCyan: '\x1b[36m',
  FgGreen: '\x1b[32m',
  FgYellow: '\x1b[33m',
  FgRed: '\x1b[31m',
  FgMagenta: '\x1b[35m',
  FgBlue: '\x1b[34m',
  Dim: '\x1b[2m',
  Bold: '\x1b[1m',
}

module.exports.COLORS = COLORS

const EMOJIS = {
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  error: '🚨',
  scan: '🔍',
  thumb: '🖼️',
  import: '📥',
  auth: '🔐',
  db: '🗄️',
  face: '👤',
  place: '🌍',
}

let scanLogCallback = null

const formatMessage = (emoji, tag, msg) => {
  return `${emoji} [${tag}] ${msg}`
}

const logger = {
  colors: COLORS,

  scan: (msg) => {
    const formatted = formatMessage(EMOJIS.scan, 'SCAN', msg)
    console.log(`${COLORS.FgMagenta}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  thumb: (msg) => {
    const formatted = formatMessage(EMOJIS.thumb, 'THUMB', msg)
    console.log(`${COLORS.FgMagenta}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  face: (msg) => {
    const formatted = formatMessage(EMOJIS.face, 'FACE', msg)
    console.log(`${COLORS.FgBlue}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  place: (msg) => {
    const formatted = formatMessage(EMOJIS.place, 'PLACE', msg)
    console.log(`${COLORS.FgGreen}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  import: (msg) => {
    const formatted = formatMessage(EMOJIS.import, 'IMPORT', msg)
    console.log(`${COLORS.FgGreen}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  info: (msg) => {
    const formatted = formatMessage(EMOJIS.info, 'INFO', msg)
    console.log(`${COLORS.FgCyan}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  success: (msg) => {
    const formatted = formatMessage(EMOJIS.success, 'OK', msg)
    console.log(`${COLORS.FgGreen}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  warn: (msg) => {
    const formatted = formatMessage(EMOJIS.warn, 'WARN', msg)
    console.warn(`${COLORS.FgYellow}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  error: (msg, err = null) => {
    const formatted = formatMessage(EMOJIS.error, 'ERROR', msg)
    console.error(`${COLORS.FgRed}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
    if (err) console.error(err)
  },

  db: (msg) => {
    const formatted = formatMessage(EMOJIS.db, 'DB', msg)
    console.log(`${COLORS.FgCyan}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  auth: (msg) => {
    const formatted = formatMessage(EMOJIS.auth, 'AUTH', msg)
    console.log(`${COLORS.FgYellow}${formatted}${COLORS.Reset}`)
    if (scanLogCallback) scanLogCallback(formatted)
  },

  scanDetail: (msg, onLog) => {
    if (onLog) onLog(msg)
    if (scanLogCallback) scanLogCallback(`ℹ️ [DETAIL] ${msg}`)
    if (process.env.DEBUG_LOGS === 'true') {
      console.log(`${COLORS.Dim}${EMOJIS.scan} [DETAIL] ${msg}${COLORS.Reset}`)
    }
  },

  setScanLogCallback: (cb) => {
    scanLogCallback = cb
  },
}

module.exports = logger
module.exports.setScanLogCallback = (cb) => {
  scanLogCallback = cb
}
