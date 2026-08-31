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

// Parse capture date from EXIF DateTimeOriginal or filename
// ExifDateTime from exiftool-vendored has raw .year/.month/.day/.hour/.minute/.second
// We extract those components and store as UTC (matching the EXIF local time in filename).
function _parseExifDateAsUtc(dateField) {
  if (dateField == null) return null

  // ExifDateTime object from exiftool-vendored: has .year, .month, etc.
  if (typeof dateField === 'object' && dateField.year != null && dateField.month != null) {
    const d = new Date(
      Date.UTC(
        parseInt(dateField.year),
        parseInt(dateField.month) - 1,
        parseInt(dateField.day) || 1,
        parseInt(dateField.hour) || 0,
        parseInt(dateField.minute) || 0,
        parseInt(dateField.second) || 0,
        dateField.millisecond != null ? parseInt(dateField.millisecond) : 0,
      ),
    )
    return isNaN(d.getTime()) ? null : d
  }

  // Regular Date — use as-is
  if (dateField instanceof Date) return dateField

  // String — try parsing EXIF format "YYYY:MM:DD HH:MM:SS"
  if (typeof dateField === 'string') {
    const match = dateField.match(/^(\d{4}):(\d{2}):(\d{2})[ ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:Z|[+-]\d{2}:?\d{2})?$/)
    if (match) {
      const d = new Date(
        Date.UTC(
          parseInt(match[1]),
          parseInt(match[2]) - 1,
          parseInt(match[3]),
          parseInt(match[4]),
          parseInt(match[5]),
          parseInt(match[6]),
          match[7] ? parseInt(match[7].slice(0, 3).padEnd(3, '0')) : 0,
        ),
      )
      return isNaN(d.getTime()) ? null : d
    }
  }

  return null
}

// Parse capture date from filename (Samsung/Canon/Sony/Nikon style)
// Patterns: IMG_YYYYMMDD_HHMMSS, DSC_YYYYMMDD_HHMMSS, etc.
// Uses Date.UTC so the ISO string matches the filename time.
function _parseDateFromFilename(filename) {
  const name = path.basename(filename)
  const match = name.match(/_(\d{4})(\d{2})(\d{2})[_\.](\d{2})(\d{2})(\d{2})/)
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second),
    ),
  )

  return isNaN(date.getTime()) ? null : date
}

// Simple filename date parse: YYYYMMDD at start of basename
function _parseDateFromFilenameSimple(filename) {
  const name = path.basename(filename)
  const match = name.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)))
  return isNaN(date.getTime()) ? null : date
}

// Apply late-night adjustment: 00:00-05:00 local → previous day
function _adjustLateNight(date) {
  const hours = date.getUTCHours()
  if (hours >= 0 && hours < 5) {
    const adjusted = new Date(date)
    adjusted.setUTCDate(adjusted.getUTCDate() - 1)
    return adjusted
  }
  return date
}

// Parse import date from file: EXIF → structured filename → mtime → now
// Returns a Date object (UTC) suitable for folder path construction.
async function parseImportDate(filePath) {
  const exiftool = require('exiftool-vendored').exiftool

  try {
    const tags = await exiftool.read(filePath)

    const dateField = tags.DateTimeOriginal || tags.CreateDate || tags.DateTimeDigitized
    if (dateField) {
      const parsed = _parseExifDateAsUtc(dateField)
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
      return _adjustLateNight(new Date(stats.mtime))
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
      // components (the camera's local time). We store them as UTC so capturedAt
      // matches the EXIF local time and the filename, without timezone conversion.
      capturedAt = _parseExifDateAsUtc(dateField)
    }

    if (!capturedAt && stat) {
      const fsDate = stat.birthtime || stat.mtime
      if (fsDate && !isNaN(new Date(fsDate).getTime())) {
        capturedAt = new Date(fsDate)
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
}
