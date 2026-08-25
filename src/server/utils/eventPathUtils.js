const { normalizePath } = require('./fileUtils')

/**
 * Date formats for parsing folder names
 * MM always before DD (no ambiguity)
 */
const DATE_FORMATS = [
  // YYYY-MM-DD or YYYY-MM-DD Name
  // ISO 8601 format (month before day)
  {
    pattern: /^(\d{4})-(\d{2})-(\d{2})(?:\s+(.*))?$/,
    handler: (m) => ({
      year: m[1],
      month: m[2], // MM
      day: m[3], // DD
      hasTitleInMatch: !!m[4],
    }),
    confidence: 1.0,
  },

  // YYYY.MM.DD or YYYY.MM.DD Name
  // Dots as separators (month before day)
  {
    pattern: /^(\d{4})\.(\d{2})\.(\d{2})(?:\s+(.*))?$/,
    handler: (m) => ({
      year: m[1],
      month: m[2], // MM
      day: m[3], // DD
      hasTitleInMatch: !!m[4],
    }),
    confidence: 1.0,
  },

  // MM.DD.YYYY or MM.DD.YYYY Name
  // American format (month before day)
  {
    pattern: /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(.*))?$/,
    handler: (m) => ({
      year: m[3],
      month: m[1], // MM
      day: m[2], // DD
      hasTitleInMatch: !!m[4],
    }),
    confidence: 0.9,
  },

  // MM.DD or MM.DD Name (year from context)
  // Current Nostalgator format
  {
    pattern: /^(\d{2})\.(\d{2})(?:\s+(.*))?$/,
    handler: (m, yearFromContext) => ({
      year: yearFromContext,
      month: m[1], // MM
      day: m[2], // DD
      hasTitleInMatch: !!m[3],
    }),
    confidence: 0.9,
  },
]

/**
 * Checks if date is valid
 * @param {Date} date
 * @returns {boolean}
 */
function isValidDate(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    return false
  }

  // Additional check: convert components back and compare
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()

  // If date was invalid, JavaScript will adjust it
  // For example, Feb 30 becomes Mar 2
  // So check that components match expected values
  return true
}

/**
 * Format date to ISO format (YYYY-MM-DD)
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  if (!isValidDate(date)) return ''

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * Parse event folder name and extract date
 *
 * Supported formats:
 * - MM.DD [Name] → date: 2026-01-07, title: "01.07 Name"
 * - MM.DD.YYYY [Name] → date: 2026-01-07, title: "01.07.2026 Name"
 * - YYYY-MM-DD [Name] → date: 2026-01-07, title: "2026-01-07 Name"
 * - YYYY.MM.DD [Name] → date: 2026-01-07, title: "2026.01.07 Name"
 * - Any name → date: null, title: "Any name"
 *
 * @param {string} folderName - Folder name (e.g. "01.07 Unreal")
 * @param {string} yearFromContext - Year from parent folder (e.g. "2026")
 * @returns {{ date: Date|null, title: string, confidence: number }}
 */
function parseEventFolderName(folderName, yearFromContext) {
  if (!folderName || typeof folderName !== 'string') {
    return {
      date: null,
      title: '',
      confidence: 0,
    }
  }

  const trimmedName = folderName.trim()

  for (const format of DATE_FORMATS) {
    const match = trimmedName.match(format.pattern)

    if (match) {
      const parsed = format.handler(match, yearFromContext)

      // Check date validity
      const date = new Date(`${parsed.year}-${parsed.month}-${parsed.day}`)

      // Additional check: JavaScript converts invalid dates
      // For example, Feb 30 becomes Mar 2
      // So check that month and day match
      const isValid =
        isValidDate(date) &&
        date.getFullYear() === parseInt(parsed.year) &&
        date.getMonth() + 1 === parseInt(parsed.month) &&
        date.getDate() === parseInt(parsed.day)

      if (isValid) {
        return {
          date,
          title: trimmedName, // Title = full folder name
          confidence: format.confidence,
        }
      }
    }
  }

  // Not recognized — return null date
  return {
    date: null,
    title: trimmedName,
    confidence: 0,
  }
}

/**
 * Checks if folder is an event (contains date in name)
 * @param {string} folderName - Folder name
 * @returns {boolean}
 */
function isEventFolder(folderName) {
  const parsed = parseEventFolderName(folderName, '2000') // Year doesn't matter
  return parsed.confidence > 0
}

/**
 * Checks if folder is a year (4 digits)
 * @param {string} folderName - Folder name
 * @returns {boolean}
 */
function isYearFolder(folderName) {
  return /^\d{4}$/.test(folderName)
}

/**
 * Create relative event path
 * @param {string} year - Year
 * @param {string} folderName - Event folder name
 * @returns {string}
 */
function buildEventPath(year, folderName) {
  return normalizePath(`${year}/${folderName}`)
}

/**
 * Create date from components
 * @param {string} year - Year
 * @param {string} month - Month (01-12)
 * @param {string} day - Day (01-31)
 * @returns {Date}
 */
function buildEventDate(year, month, day) {
  return new Date(`${year}-${month}-${day}`)
}

module.exports = {
  parseEventFolderName,
  isValidDate,
  formatDate,
  isEventFolder,
  isYearFolder,
  buildEventPath,
  buildEventDate,
}
