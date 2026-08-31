const fs = require('fs').promises
const path = require('path')
const sharp = require('sharp')
const ffmpeg = require('fluent-ffmpeg')
const logger = require('../utils/logger')
const { VIDEO_EXTENSIONS } = require('../utils/fileUtils')

// Explicitly specify ffmpeg path for Windows
if (process.platform === 'win32') {
  const { execSync } = require('child_process')
  try {
    const ffmpegPath = execSync('where ffmpeg').toString().split('\r\n')[0].trim()
    ffmpeg.setFfmpegPath(ffmpegPath)
  } catch (err) {
    // FFmpeg not found — video thumbnails will not be generated
  }
}

/**
 * ThumbnailService — thumbnail generation
 */
class ThumbnailService {
  constructor(thumbnailsPath, originalsPath, websocketService = null) {
    this.thumbnailsPath = thumbnailsPath
    this.originalsPath = originalsPath
    this.websocketService = websocketService
    this.queue = []
    this.isProcessing = false
    this.processingCount = 0
    this.processedCount = 0
    this.MAX_CONCURRENT = 2
    this.waiters = [] // Array for waiting for queue completion
    this._backgroundRunning = false // Flag for continuous background loop
    this.folderProgress = new Map() // folderPath -> { total, pending }
  }

  /** Check if the queue is active */
  isQueueActive() {
    return this.queue.length > 0 || this.isProcessing || this.processingCount > 0
  }

  /**
   * Add ONE file to the thumbnail generation queue
   * Automatically starts background processing
   * @param {Object} info - { eventId, year, folderPath, filename, isVideo }
   * @param {Object} [options] - { force: boolean }
   */
  queueGeneration(info, options = {}) {
    this.queue.push({ ...info, force: options.force === true })
    // Track per-folder progress so we can log completion once per folder.
    if (info.folderPath) {
      const p = this.folderProgress.get(info.folderPath) || { total: 0, pending: 0 }
      p.total += 1
      p.pending += 1
      this.folderProgress.set(info.folderPath, p)
    }
    // Do NOT send WS here — _continuousLoop does it on start/stop
    // Each queueGeneration call was sending thumbnails:true → indicator blinking
    if (!this._backgroundRunning) {
      this._ensureBackgroundRunning()
    }
  }

  /** Start continuous background queue processing loop */
  _ensureBackgroundRunning() {
    if (this._backgroundRunning) return
    this._backgroundRunning = true
    this._continuousLoop().catch((err) => {
      logger.error('Continuous background loop error', err)
    })
  }

  /** Continuous loop — runs while queue has items, then stops */
  async _continuousLoop() {
    this.isProcessing = true
    // Send WS that thumbnails are active (once on loop start)
    if (this.websocketService) {
      this.websocketService.notifyScanProcessChanged(
        'thumbnails',
        true,
        this.queue.length,
        this.processingCount,
      )
    }
    try {
      while (this._backgroundRunning) {
        if (this.queue.length === 0) {
          while (this._backgroundRunning && this.processingCount > 0) {
            await this.sleep(100)
          }
          if (this.queue.length === 0) {
            break
          }
          continue
        }
        while (this.processingCount >= this.MAX_CONCURRENT) {
          await this.sleep(100)
        }
        const item = this.queue.shift()
        this.processingCount++
        this.processItemInBackground(item)
      }
    } finally {
      this._backgroundRunning = false
      this.isProcessing = false
      this.waiters.forEach((resolve) => resolve())
      this.waiters = []
      if (this.websocketService) {
        this.websocketService.notifyScanProcessChanged('thumbnails', false, 0, 0)
      }
    }
  }

  /** Process thumbnail queue (blocking, waits for completion) */
  async processQueue() {
    if (this.queue.length === 0 && !this._backgroundRunning) {
      return
    }
    // If background loop is NOT running but queue exists — start it
    if (!this._backgroundRunning && this.queue.length > 0) {
      this._ensureBackgroundRunning()
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  // Process queue item in background
  async processItemInBackground(item) {
    try {
      await this.generateFileThumbnail(item)
    } catch (error) {
      logger.error(`Background thumbnail failed for ${item.filename}: ${error.message}`)
      // Don't return to queue — let it be skipped
    } finally {
      this.processingCount--
      this.processedCount++
      const fp = item.folderPath
      if (fp) {
        const p = this.folderProgress.get(fp)
        if (p) {
          p.pending -= 1
          if (p.pending <= 0) {
            this.folderProgress.delete(fp)
            logger.thumb(`${fp}: ${p.total} files`)
          }
        }
      }
    }
  }

  // Generate thumbnail for a SINGLE file
  async generateFileThumbnail({ eventId, year, folderPath, filename, isVideo, force = false }) {
    try {
      const eventThumbnailsPath = path.join(
        this.thumbnailsPath,
        year.toString(),
        eventId.toString(),
      )
      await fs.mkdir(eventThumbnailsPath, { recursive: true })

      const inputPath = path.join(this.originalsPath, folderPath.replace(/\//g, path.sep), filename)

      const outputFile = path.join(eventThumbnailsPath, filename)
      const finalOutputFile = isVideo ? outputFile + '.jpg' : outputFile

      if (force) {
        try {
          await fs.unlink(finalOutputFile)
        } catch (_) {}
      }

      try {
        await fs.access(finalOutputFile)
        // logger.thumb(`Thumbnail exists ${filename}`);
        return // thumbnail already exists
      } catch (_) {}

      if (isVideo) {
        await this.generateVideoThumbnail(inputPath, finalOutputFile)
      } else {
        // logger.thumb(`New thumb ${filename}`);
        await this.generateImageThumbnail(inputPath, finalOutputFile)
      }
    } catch (error) {
      logger.error(`Thumbnail failed for ${filename}: ${error.message}`)
    }
  }

  // Helper function for delay
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async generateImageThumbnail(inputPath, outputPath) {
    try {
      await sharp(inputPath, { failOn: 'none' }) // Ignore errors in SOS markers
        .rotate()
        .resize(256, 256, { fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 80 })
        .toFile(outputPath)
    } catch (error) {
      // If it still fails with failOn: 'none', the file is critically corrupted
      throw new Error(`Image thumbnail failed for ${inputPath}: ${error.message}`)
    }
  }

  // Generate video thumbnail
  async generateVideoThumbnail(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vf', 'select=eq(n\\,0),scale=-2:256', '-vframes', '1', '-q:v', '2'])
        .on('end', () => resolve())
        .on('error', (err) =>
          reject(new Error(`Video thumbnail failed for ${inputPath}: ${err.message}`)),
        )
        .save(outputPath)
    })
  }

  // Create placeholder thumbnail
  async createPlaceholderThumbnail(outputPath) {
    try {
      await sharp({
        create: {
          width: 256,
          height: 256,
          channels: 3,
          background: { r: 200, g: 200, b: 200 },
        },
      })
        .jpeg({ quality: 80 })
        .toFile(outputPath)
    } catch (error) {
      logger.error('Placeholder thumbnail failed', error)
    }
  }

  /**
   * Get list of thumbnails for event
   * @param {number} eventId - Event ID
   * @param {number} year - Event year
   * @param {number} limit - Maximum number of thumbnails
   * @param {Object} prisma - Prisma client
   */
  async getThumbnailsForEvent(eventId, year, limit, prisma) {
    try {
      const mediaRecords = await prisma.media.findMany({
        where: { eventId },
        select: { id: true, filename: true, clusterId: true, capturedAt: true },
        orderBy: [{ capturedAt: 'asc' }, { filename: 'asc' }],
        take: limit ? parseInt(limit, 10) : undefined,
      })

      const mediaIds = mediaRecords.map((m) => m.id)
      const faceRows =
        mediaIds.length > 0
          ? await prisma.face.findMany({
              where: { mediaId: { in: mediaIds } },
              include: {
                person: {
                  include: { participant: { select: { name: true } } },
                },
              },
            })
          : []

      const participantsByMedia = {}
      faceRows.forEach((f) => {
        if (f.person?.participant?.name) {
          if (!participantsByMedia[f.mediaId]) participantsByMedia[f.mediaId] = new Set()
          participantsByMedia[f.mediaId].add(f.person.participant.name)
        }
      })

      const cacheBuster = Date.now()

      const thumbnails = []
      for (const media of mediaRecords) {
        const ext = path.extname(media.filename).toLowerCase()
        const isVideoThumb = VIDEO_EXTENSIONS.includes(ext)
        const thumbFilename = isVideoThumb ? media.filename + '.jpg' : media.filename
        const thumbnailPath = path.join(
          this.thumbnailsPath,
          year.toString(),
          eventId.toString(),
          thumbFilename,
        )
        try {
          await fs.access(thumbnailPath)
          const participantSet = participantsByMedia[media.id] || new Set()
          thumbnails.push({
            id: media.id,
            filename: media.filename,
            capturedAt: media.capturedAt,
            url: `/thumbnails/${year}/${eventId}/${thumbFilename}?v=${cacheBuster}`,
            clusterId: media.clusterId ?? null,
            participants: Array.from(participantSet),
          })
        } catch (e) {
          continue
        }
      }

      return thumbnails
    } catch (error) {
      logger.error(`Failed to get thumbnails for event ${eventId}`, error)
      return []
    }
  }
}

module.exports = ThumbnailService
