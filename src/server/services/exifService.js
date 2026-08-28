/**
 * ExifService — reading EXIF data from files
 */
const path = require('path')
const logger = require('../utils/logger')
const { exiftool } = require('exiftool-vendored')
const fs = require('fs').promises

class ExifService {
  /**
   * Read EXIF data from file
   * @param {String} filePath — full path to file
   * @returns {Object|null} EXIF data or null if no EXIF
   */
  async getExif(filePath) {
    try {
      const tags = await exiftool.read(filePath)

      // Get dates from filesystem
      const stats = await fs.stat(filePath)

      // Format main data
      return {
        // Camera
        make: tags.Make,
        model: tags.Model,
        camera: this._formatCamera(tags.Make, tags.Model),
        lens: tags.LensModel,

        // Shooting settings
        exposure: tags.ExposureTime,
        aperture: tags.FNumber,
        iso: tags.ISO,
        focalLength: tags.FocalLength,
        exposureProgram: tags.ExposureProgram,
        meteringMode: tags.MeteringMode,
        flash: tags.Flash,

        // Date and time (EXIF)
        dateTime: tags.DateTimeOriginal,
        dateTimeDigitized: tags.CreateDate,
        dateTimeModified: tags.ModifyDate,

        // Date and time (filesystem)
        fileCreated: stats.birthtime,
        fileModified: stats.mtime,

        // GPS
        gps: tags.GPSPosition,
        gpsLatitude: tags.GPSLatitude,
        gpsLongitude: tags.GPSLongitude,
        gpsAltitude: tags.GPSAltitude,

        // File
        fileSize: tags.FileSize,
        fileType: tags.FileType,
        mimeType: tags.MIMEType,

        // Image
        imageWidth: tags.ImageWidth,
        imageHeight: tags.ImageHeight,
        orientation: tags.Orientation,
        xResolution: tags.XResolution,
        yResolution: tags.YResolution,

        // Authorship
        artist: tags.Artist,
        copyright: tags.Copyright,
        software: tags.Software,

        // All raw data (for debugging)
        raw: tags,
      }
    } catch (error) {
      logger.error(`EXIF read failed for ${filePath}: ${error.message}`)
      return null
    }
  }

  /**
   * Format camera name
   * @param {string} make
   * @param {string} model
   * @returns {string|null}
   */
  _formatCamera(make, model) {
    const parts = [make, model].filter(Boolean)
    return parts.join(' ') || null
  }

  async writeExif(filePath, tags) {
    try {
      const normalizedPath = path.normalize(filePath)
      await exiftool.write(normalizedPath, tags)
      return true
    } catch (error) {
      logger.error(`EXIF write failed for ${filePath}: ${error.message}`)
      throw error
    }
  }
}

module.exports = ExifService
