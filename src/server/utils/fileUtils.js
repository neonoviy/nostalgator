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

// Extract EXIF data for Media record
// Returns: { capturedAt, latitude, longitude, width, height, duration }
// Skip videos — they don't have DateTimeOriginal in EXIF
async function extractExifData(filePath) {
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
      capturedAt = dateField instanceof Date ? dateField : new Date(dateField)
      if (isNaN(capturedAt.getTime())) capturedAt = null
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
}
