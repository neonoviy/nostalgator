const fs = require('fs').promises
const fsSync = require('fs') // for createReadStream (hashFileChunk)
const path = require('path')
const crypto = require('crypto')
const logger = require('./logger')

// Media file extensions
const MEDIA_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp', // Images
  '.mp4',
  '.mov',
  '.avi',
  '.mkv', // Video
]

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv']

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']

// Map extensions to MIME types
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
}

// Normalize path: replace backslashes with forward slashes
function normalizePath(filePath) {
  if (!filePath) return null
  return filePath.replace(/\\/g, '/')
}

// Check: is the file a media file
function isMediaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MEDIA_EXTENSIONS.includes(ext)
}

// Get list of media files from folder
async function getMediaFiles(dirPath) {
  try {
    // Check folder existence
    try {
      await fs.access(dirPath)
    } catch (error) {
      return []
    }

    const files = await fs.readdir(dirPath)

    return files
      .filter((file) => {
        const ext = path.extname(file).toLowerCase()
        return MEDIA_EXTENSIONS.includes(ext)
      })
      .map((filename) => {
        const ext = path.extname(filename).toLowerCase()
        return {
          filename,
          fullPath: path.join(dirPath, filename),
          isVideo: VIDEO_EXTENSIONS.includes(ext),
          isImage: IMAGE_EXTENSIONS.includes(ext),
        }
      })
  } catch (error) {
    logger.error('Failed to get media files', error)
    return []
  }
}

// Get MIME type by file extension
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

// Compute SHA-256 hash of first file chunk (for deduplication)
async function hashFileChunk(filePath, chunkSize = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fsSync.createReadStream(filePath, { start: 0, end: chunkSize - 1 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// Convert GPS from DMS [deg, min, sec] to decimal degrees
function _dmsToDecimal(dms, ref) {
  const [deg, min, sec] = dms
  let decimal = Math.abs(deg) + min / 60 + sec / 3600
  // South/west = negative
  if (ref === 'S' || ref === 'W') decimal = -decimal
  return decimal
}

// Convert GPS value from exiftool to decimal degrees
// exiftool may return:
//   - number (decimal degrees) — already ready
//   - array [deg, min, sec] — DMS
//   - object with fields
function _parseGpsValue(value, ref) {
  if (value == null) return null

  // If array — DMS
  if (Array.isArray(value) && value.length >= 3) {
    return _dmsToDecimal(value, ref)
  }

  // If number — already decimal
  const num = parseFloat(value)
  return isNaN(num) ? null : num
}

// Parse capture date from EXIF DateTimeOriginal or filename.
// The application must be timezone-agnostic: EXIF DateTimeOriginal is local
// civil time on the camera clock and must be preserved as-is. We construct
// the Date via the (year, month, day, hour, ...) overload so its UTC instant
// is timezone-dependent, but getHours()/getDate()/getMonth()/getFullYear()
// always return the exact components from EXIF — no conversion, no shift.
function _parseExifDateAsLocal(dateField) {
  if (dateField == null) return null

  // ExifDateTime object from exiftool-vendored: has .year, .month, etc.
  if (typeof dateField === 'object' && dateField.year != null && dateField.month != null) {
    const d = new Date(
      parseInt(dateField.year),
      parseInt(dateField.month) - 1,
      parseInt(dateField.day) || 1,
      parseInt(dateField.hour) || 0,
      parseInt(dateField.minute) || 0,
      parseInt(dateField.second) || 0,
      dateField.millisecond != null ? parseInt(dateField.millisecond) : 0,
    )
    return isNaN(d.getTime()) ? null : d
  }

  // Regular Date — read local components and rebuild as local to strip any TZ
  // influence from the source.
  if (dateField instanceof Date) {
    return new Date(
      dateField.getFullYear(),
      dateField.getMonth(),
      dateField.getDate(),
      dateField.getHours(),
      dateField.getMinutes(),
      dateField.getSeconds(),
      dateField.getMilliseconds(),
    )
  }

  // String — try parsing EXIF format "YYYY:MM:DD HH:MM:SS"
  if (typeof dateField === 'string') {
    const match = dateField.match(/^(\d{4}):(\d{2}):(\d{2})[ ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?$/)
    if (match) {
      const ms = match[7] ? parseInt(match[7].slice(0, 3).padEnd(3, '0')) : 0
      const d = new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3]),
        parseInt(match[4]),
        parseInt(match[5]),
        parseInt(match[6]),
        ms,
      )
      return isNaN(d.getTime()) ? null : d
    }
  }

  return null
}

// Parse capture date from filename (Samsung/Canon/Sony/Nikon style)
// Patterns: IMG_YYYYMMDD_HHMMSS, DSC_YYYYMMDD_HHMMSS, etc.
// The numbers in the filename are local civil time on the camera clock —
// we store them as local components, not UTC.
function _parseDateFromFilename(filename) {
  const name = path.basename(filename)
  const match = name.match(/_(\d{4})(\d{2})(\d{2})[_\.](\d{2})(\d{2})(\d{2})/)
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second),
  )

  return isNaN(date.getTime()) ? null : date
}

// Simple filename date parse: YYYYMMDD at start of basename
function _parseDateFromFilenameSimple(filename) {
  const name = path.basename(filename)
  const match = name.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  return isNaN(date.getTime()) ? null : date
}

// Hour on the camera clock at and after which a photo is treated as belonging
// to the previous day. Configurable via the LATE_NIGHT_HOUR env var
// (default 5 — i.e. 00:00–04:59 → previous day; LATE_NIGHT_HOUR=6 would mean
// 00:00–05:59, LATE_NIGHT_HOUR=0 disables the rule).
function _getLateNightHour() {
  const raw = process.env.LATE_NIGHT_HOUR
  if (raw == null || raw === '') return 5
  const n = parseInt(raw, 10)
  if (isNaN(n) || n < 0 || n > 23) return 5
  return n
}

// Apply late-night adjustment: hour < LATE_NIGHT_HOUR on the camera clock
// → previous day. Uses local getters because the Date is constructed with
// local civil time components — there is no timezone concept in this pipeline.
function _adjustLateNight(date) {
  const threshold = _getLateNightHour()
  if (threshold === 0) return date
  const hours = date.getHours()
  if (hours >= 0 && hours < threshold) {
    const adjusted = new Date(date)
    adjusted.setDate(adjusted.getDate() - 1)
    return adjusted
  }
  return date
}

// Format a Date into an ISO string with a trailing 'Z' marker using the Date's
// LOCAL components (year/month/day/hour/.../ms are taken from the instance
// as-is, regardless of system timezone). This is a valid Prisma DateTime
// representation; the app treats the value as timezone-agnostic (camera-clock
// civil time) and renders only the calendar/clock components, never the zone.
function formatDateAsUtcIso(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}Z`
  )
}

// Format a Date into a string using tokens like YYYY, MM, DD, HH, mm, ss, SSS.
// Uses local components because the Date represents camera-clock civil time
// (the pipeline is timezone-agnostic).
// Example: formatDateForFilename(date, 'YYYYMMDD_HHmmssSSS') => '20240115_143022123'
// SSS (3-digit milliseconds) is useful for uniqueness when multiple photos
// share the same second.
// A single-pass regex replace prevents token collisions (e.g. 'MM' vs 'mm').
// Longer tokens (SSS) must come first in the alternation to avoid 'ss'
// matching inside 'SSS' (though case-sensitive regex makes this safe, it's
// good practice).
function formatDateForFilename(date, formatString) {
  const pad = (num, len = 2) => String(num).padStart(len, '0')

  const tokenMap = {
    YYYY: date.getFullYear(),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    SSS: pad(date.getMilliseconds(), 3),
  }

  return formatString.replace(/SSS|YYYY|MM|DD|HH|mm|ss/g, (match) => tokenMap[match])
}

// Sanitize a string for safe use in a filename.
// Removes or replaces characters that are invalid in filenames across platforms.
// Useful for future extensions where tokens may come from EXIF tags (e.g., OwnerName, Artist).
function sanitizeForFilename(str) {
  if (!str) return ''
  return str
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, '_') // Replace whitespace with underscore
    .replace(/_{2,}/g, '_') // Collapse multiple underscores
    .replace(/^_+|_+$/g, '') // Trim leading/trailing underscores
}

// Parse import date from file: EXIF → structured filename → mtime → now.
// Returns a Date whose local getters yield the camera-clock components
// verbatim — the application is timezone-agnostic and never shifts the date.
async function parseImportDate(filePath) {
  const exiftool = require('exiftool-vendored').exiftool

  try {
    const tags = await exiftool.read(filePath)

    const dateField = tags.DateTimeOriginal || tags.CreateDate || tags.DateTimeDigitized
    if (dateField) {
      const parsed = _parseExifDateAsLocal(dateField)
      if (parsed) return _adjustLateNight(parsed)
    }
  } catch (err) {
    // exiftool read failed — fall through to filename/mtime
  }

  const filenameDate = _parseDateFromFilename(filePath) || _parseDateFromFilenameSimple(filePath)
  if (filenameDate) return _adjustLateNight(filenameDate)

  try {
    const stats = await fs.stat(filePath)
    if (stats.mtime && !isNaN(new Date(stats.mtime).getTime())) {
      // mtime is a real Date instant; rebuild it as local civil so the rest
      // of the pipeline treats it the same as EXIF/filename dates.
      const m = new Date(stats.mtime)
      const localMtime = new Date(
        m.getFullYear(),
        m.getMonth(),
        m.getDate(),
        m.getHours(),
        m.getMinutes(),
        m.getSeconds(),
        m.getMilliseconds(),
      )
      return _adjustLateNight(localMtime)
    }
  } catch (err) {
    // stat failed — use now
  }

  return _adjustLateNight(new Date())
}

// Extract EXIF data for Media record
// Returns: { capturedAt, latitude, longitude, width, height, duration }
// Skip videos — they don't have DateTimeOriginal in EXIF
async function extractExifData(filePath, stat) {
  const ext = path.extname(filePath).toLowerCase()
  const isVideo = VIDEO_EXTENSIONS.includes(ext)

  try {
    const exiftool = require('exiftool-vendored').exiftool
    const tags = await exiftool.read(filePath)

    // Capture date (videos may also have CreateDate)
    let capturedAt = null
    const dateField = isVideo
      ? tags.CreateDate || tags.DateTimeOriginal || tags.DateTimeDigitized
      : tags.DateTimeOriginal || tags.CreateDate || tags.DateTimeDigitized
    if (dateField) {
      // ExifDateTime from exiftool-vendored has raw .year/.month/.day/.hour/.minute/.second
      // — the camera's local civil time. We preserve those components verbatim
      // (no UTC conversion) because the app is timezone-agnostic.
      capturedAt = _parseExifDateAsLocal(dateField)
    }

    if (!capturedAt && stat) {
      const fsDate = stat.birthtime || stat.mtime
      if (fsDate && !isNaN(new Date(fsDate).getTime())) {
        // fs stat returns a real Date instant; keep its local civil components
        // so capturedAt matches what the user sees in the file properties.
        const d = new Date(fsDate)
        capturedAt = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          d.getHours(),
          d.getMinutes(),
          d.getSeconds(),
          d.getMilliseconds(),
        )
      }
    }

    if (!capturedAt) {
      capturedAt = _parseDateFromFilename(path.basename(filePath))
    }

    // GPS coordinates
    let latitude = null
    let longitude = null
    if (tags.GPSLatitude != null && tags.GPSLongitude != null) {
      const latRef = tags.GPSLatitudeRef || 'N'
      const lngRef = tags.GPSLongitudeRef || 'E'
      latitude = _parseGpsValue(tags.GPSLatitude, latRef)
      longitude = _parseGpsValue(tags.GPSLongitude, lngRef)
    }

    // Dimensions (images and video)
    let width = null
    let height = null
    // exiftool returns ImageWidth/ImageHeight for photos and ImageWidth/ImageHeight for video
    width = tags.ImageWidth || tags.SourceImageWidth || tags.VideoFrameWidth || null
    height = tags.ImageHeight || tags.SourceImageHeight || tags.VideoFrameHeight || null
    if (width != null) width = parseInt(width)
    if (height != null) height = parseInt(height)
    if (isNaN(width)) width = null
    if (isNaN(height)) height = null

    // Video duration
    let duration = null
    if (isVideo && tags.Duration != null) {
      // Duration may be a number (seconds) or string
      if (typeof tags.Duration === 'number') {
        duration = tags.Duration
      } else if (typeof tags.Duration === 'string') {
        // Format: "00:01:23.456" → seconds
        const parts = tags.Duration.split(':')
        if (parts.length === 3) {
          duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])
        }
      }
    }

    return { capturedAt, latitude, longitude, width, height, duration }
  } catch (err) {
    // Failed to read EXIF — continue without it
    return {
      capturedAt: null,
      latitude: null,
      longitude: null,
      width: null,
      height: null,
      duration: null,
    }
  }
}

// Get media file info
async function getMediaInfo(filePath) {
  const stat = await fs.stat(filePath)
  const ext = path.extname(filePath).toLowerCase()

  return {
    filename: path.basename(filePath),
    size: stat.size,
    birthtime: stat.birthtime,
    mtime: stat.mtime,
    extension: ext,
    mimeType: getMimeType(filePath),
    isVideo: VIDEO_EXTENSIONS.includes(ext),
    isImage: IMAGE_EXTENSIONS.includes(ext),
  }
}

// Recursive folder scan
async function scanDirectory(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files = []

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        const nestedFiles = await scanDirectory(fullPath)
        files.push(...nestedFiles)
      } else {
        files.push(fullPath)
      }
    }

    return files
} catch (error) {
  logger.error(`Failed to scan directory ${dirPath}`, error)
  return []
}
}

// Extract the "owner" from the file path relative to the import directory.
// If any path segment (directory) starts with '_', it's treated as an owner
// prefix (e.g. '_Denis' in 'Import/_Denis/photo.jpg' yields 'Denis').
// Returns the sanitized owner name, or null if no owner folder is found.
function extractFolderOwner(filePath, importPath) {
  try {
    // Resolve paths to absolute to ensure path.relative works correctly
    const resolvedImportPath = path.resolve(importPath)
    const resolvedFilePath = path.resolve(filePath)
    const relativePath = path.relative(resolvedImportPath, resolvedFilePath)

    // If the relative path starts with '..' the file is not under the import directory
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null
    }

    const segments = relativePath.split(path.sep)

    for (const segment of segments) {
      if (segment.startsWith('_')) {
        const owner = segment.slice(1) // Remove the '_' prefix
        const sanitized = sanitizeForFilename(owner)
        return sanitized || null
      }
    }
  } catch (err) {
    // If the file is not under the import path, path.relative will fail or
    // produce a path that doesn't match — just return null.
    return null
  }
  return null
}

module.exports = {
  getMediaInfo,
  getMimeType,
  hashFileChunk,
  extractExifData,
  scanDirectory,
  normalizePath,
  isMediaFile,
  getMediaFiles,
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  parseImportDate,
  formatDateForFilename,
  formatDateAsUtcIso,
  sanitizeForFilename,
  extractFolderOwner,
}
