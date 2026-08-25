const fs = require('fs').promises
const path = require('path')
const { normalizePath, getMediaFiles } = require('../utils/fileUtils')
const { parseEventFolderName, isYearFolder, buildEventPath } = require('../utils/eventPathUtils')
const logger = require('../utils/logger')
const { withRetry } = require('../utils/retry')

/**
 * ScanService — file system scanning
 */
class ScanService {
  constructor(
    eventService,
    originalsPath,
    thumbnailService = null,
    websocketService = null,
    placeRecognitionService = null,
    faceRecognitionService = null,
    settingsService = null,
  ) {
    this.eventService = eventService
    this.originalsPath = originalsPath
    this.thumbnailService = thumbnailService
    this.websocketService = websocketService
    this.placeRecognitionService = placeRecognitionService
    this.faceRecognitionService = faceRecognitionService
    this.settingsService = settingsService
    this.autodetectFaces =
      process.env.AUTODETECT_FACES === 'true' || process.env.AUTODETECT_FACES === undefined
    this.autodetectPlaces = process.env.AUTODETECT_PLACES !== 'false'
  }

  updateSettings({ autodetectFaces, autodetectPlaces }) {
    if (autodetectFaces !== undefined) this.autodetectFaces = autodetectFaces
    if (autodetectPlaces !== undefined) this.autodetectPlaces = autodetectPlaces
  }

  /**
   * Scan the originals folder
   * @param {string} mode - 'full' | 'incremental'
   * @param {Function} [onLog] - callback for logs
   * @param {string[]} [selectedFolders] - relative paths of selected folders (year or year/event)
   * @param {Object} [forceFlags] - { forceFaces, forcePlaces, forceThumbs }
   * @returns {Promise<boolean>}
   */
  async scanOriginalsFolder(
    mode = 'incremental',
    onLog = null,
    selectedFolders = [],
    forceFlags = {},
  ) {
    const startTime = Date.now()
    const log = onLog || (() => {})
    try {
      if (selectedFolders.length > 0) {
        log(`=== SCANNING Folders (${selectedFolders.length}): ${selectedFolders.join(', ')}`)
      } else {
        log('SCANNING all folders')
      }

      if (forceFlags.forceFaces || forceFlags.forcePlaces || forceFlags.forceThumbs) {
        const flags = []
        if (forceFlags.forceFaces) flags.push('Force faces=true')
        if (forceFlags.forcePlaces) flags.push('Force places=true')
        if (forceFlags.forceThumbs) flags.push('Force thumbs=true')
        log(flags.join(', '))
      }

      try {
        await fs.access(this.originalsPath)
      } catch (_error) {
        log(`Originals folder not found: ${this.originalsPath}`)
        return
      }

      const years = await fs.readdir(this.originalsPath)
      const currentYear = new Date().getFullYear()
      let yearsToScan =
        mode === 'incremental' ? years.filter((y) => parseInt(y) >= currentYear - 1) : years

      const selectedYears = new Set()
      const selectedEventPaths = new Set()
      if (selectedFolders.length > 0) {
        for (const folder of selectedFolders) {
          const parts = folder.split('/').filter(Boolean)
          if (parts.length === 1) {
            selectedYears.add(parts[0])
          } else if (parts.length >= 2) {
            selectedYears.add(parts[0])
            selectedEventPaths.add(folder)
          }
        }
        if (selectedYears.size > 0) {
          const matched = yearsToScan.filter((y) => selectedYears.has(y))
          if (matched.length > 0) yearsToScan = matched
        }
      }

      if (yearsToScan.length === 0) {
        log('No years to scan')
        return
      }

      const prisma = this.eventService.prisma
      const beforeCounts = await Promise.all([
        prisma.event.count(),
        prisma.media.count(),
        prisma.face.count(),
        prisma.person.count(),
        prisma.place.count(),
        prisma.cluster.count(),
      ])

      this.placeRecognitionService?.setScanActive(true)
      this.faceRecognitionService?.setScanActive(true)

      if (this.thumbnailService) {
        this.thumbnailService.processedCount = 0
      }

      let eventsScanned = 0
      let eventsAdded = 0

      for (const year of yearsToScan) {
        const result = await this.scanYear(year, log, mode, selectedEventPaths, forceFlags)
        eventsScanned += result.scanned
        eventsAdded += result.added
      }

      this.placeRecognitionService?.setScanActive(false)
      this.faceRecognitionService?.setScanActive(false)

      if (this.placeRecognitionService) {
        await this.placeRecognitionService.processQueue()
      }

      if (this.faceRecognitionService) {
        await this.faceRecognitionService.processQueue()
      }

      if (this.thumbnailService) {
        await this.thumbnailService.processQueue()
      }

      const elapsed = Date.now() - startTime
      const formatDuration = (ms) => {
        const totalSec = Math.floor(ms / 1000)
        const h = Math.floor(totalSec / 3600)
        const m = Math.floor((totalSec % 3600) / 60)
        const s = totalSec % 60
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      }
      const duration = formatDuration(elapsed)

      log(`=== SCAN FINISHED IN: ${duration}`)

      try {
        const [totalEvents, totalMedia, totalFaces, totalPersons, totalPlaces, totalClusters] =
          await Promise.all([
            prisma.event.count(),
            prisma.media.count(),
            prisma.face.count(),
            prisma.person.count(),
            prisma.place.count(),
            prisma.cluster.count(),
          ])

        const addedEvents = totalEvents - beforeCounts[0]
        const addedMedia = totalMedia - beforeCounts[1]
        const addedFaces = totalFaces - beforeCounts[2]
        const addedPersons = totalPersons - beforeCounts[3]
        const addedPlaces = totalPlaces - beforeCounts[4]
        const addedClusters = totalClusters - beforeCounts[5]

        log(
          `Added: events=${addedEvents} media=${addedMedia} faces=${addedFaces} persons=${addedPersons} places=${addedPlaces} clusters=${addedClusters}`,
        )
        log(
          `Totals: events=${totalEvents} media=${totalMedia} faces=${totalFaces} persons=${totalPersons} places=${totalPlaces} clusters=${totalClusters}`,
        )
      } catch (_statsError) {
        log(`Added during scan: ${eventsAdded} events`)
      }

      return true
    } catch (error) {
      logger.error('Scan failed', error)
      this.placeRecognitionService?.setScanActive(false)
      this.faceRecognitionService?.setScanActive(false)
      return false
    }
  }

  /**
   * Scan a single year
   * @param {string} year
   * @param {Function} log
   * @param {string} mode
   * @param {Set<string>} [selectedEventPaths] - relative paths of selected events in year/event format
   * @param {Object} [forceFlags] - { forceFaces, forcePlaces, forceThumbs }
   */
  async scanYear(
    year,
    log = () => {},
    mode = 'incremental',
    selectedEventPaths = new Set(),
    forceFlags = {},
  ) {
    const yearPath = path.join(this.originalsPath, year)
    let scanned = 0
    let added = 0

    try {
      const stat = await fs.stat(yearPath)
      if (stat.isDirectory()) {
        let events = await fs.readdir(yearPath)
        if (selectedEventPaths.size > 0) {
          events = events.filter((event) =>
            selectedEventPaths.has(normalizePath(path.join(year, event))),
          )
        }

        for (const event of events) {
          const eventPath = path.join(yearPath, event)
          const result = await this.scanEvent(
            eventPath,
            log,
            mode,
            null,
            forceFlags,
            selectedEventPaths,
          )
          if (result) {
            scanned++
            if (result.isNew) added++
          }
        }
      }
    } catch (yearError) {
      log(`Year ${year} error: ${yearError.message}`)
    }

    return { scanned, added }
  }

  /**
   * Scan a single event
   * @param {string} eventPath
   * @param {Function} log
   * @param {string} mode
   * @param {number|null} uploadedById — ID of user who uploaded via Import
   * @param {Object} [forceFlags] - { forceFaces, forcePlaces, forceThumbs }
   * @param {Set<string>} [selectedEventPaths] - relative paths of selected events
   * @returns {Promise<Object|null>}
   */
  async scanEvent(
    eventPath,
    log = () => {},
    mode = 'incremental',
    uploadedById = null,
    forceFlags = {},
    selectedEventPaths = new Set(),
  ) {
    const parts = eventPath.split(path.sep)
    const event = parts[parts.length - 1]
    const year = parts[parts.length - 2]
    const relativePath = normalizePath(path.join(year, event))

    try {
      const eventStat = await fs.stat(eventPath)
      if (eventStat.isDirectory()) {
        const { forceFaces = false, forcePlaces = false, forceThumbs = false } = forceFlags
        const existingEvent = await this.eventService.getEventByFolderPath(relativePath)
        const isSelected = selectedEventPaths && selectedEventPaths.has(relativePath)
        const forceFlagsForEvent = { forceFaces, forcePlaces, forceThumbs }

        if (existingEvent && existingEvent.lastScannedAt) {
          const mtimeMs = eventStat.mtimeMs
          const lastScannedMs = new Date(existingEvent.lastScannedAt).getTime()

          if (!isSelected && lastScannedMs >= mtimeMs) {
            if (mode === 'full') {
              const thumbMediaFiles = await getMediaFiles(eventPath)
              if (forceThumbs) {
                for (const f of thumbMediaFiles) {
                  const eventThumbnailsPath = path.join(
                    this.thumbnailService?.thumbnailsPath || '',
                    year.toString(),
                    existingEvent.id.toString(),
                  )
                  const outputFile = path.join(
                    eventThumbnailsPath,
                    f.isVideo ? f.filename + '.jpg' : f.filename,
                  )
                  try {
                    await fs.unlink(outputFile)
                  } catch (err) {
                    /* ignore */
                  }
                }
              }
              for (const f of thumbMediaFiles) {
                this.thumbnailService?.queueGeneration({
                  eventId: existingEvent.id,
                  year: parseInt(year),
                  folderPath: relativePath,
                  filename: f.filename,
                  isVideo: f.isVideo,
                  ...(forceThumbs ? { force: true } : {}),
                })
              }
              logger.thumb(`THUMB ${relativePath}: ${thumbMediaFiles.length} files`)
              await this.eventService.syncEventMedia(existingEvent.id, relativePath)
              if (this.placeRecognitionService && (forcePlaces || this.autodetectPlaces)) {
                this.placeRecognitionService.queueGeneration({
                  id: existingEvent.id,
                  year: parseInt(year),
                  folderPath: relativePath,
                  isFirstScan: false,
                  mode,
                  ...(forcePlaces ? { force: true } : {}),
                })
              }
              if (this.faceRecognitionService && (forceFaces || this.autodetectFaces)) {
                this.faceRecognitionService.queueGeneration({
                  id: existingEvent.id,
                  folderPath: relativePath,
                  ...(forceFaces ? { force: true } : {}),
                })
              }
            }
            return { isNew: false }
          }

          const mediaFiles = await getMediaFiles(eventPath)
          const currentMediaCount = mediaFiles.length

          if (existingEvent.mediaCount !== currentMediaCount || isSelected) {
            await withRetry(
              () => this.eventService.syncEventMedia(existingEvent.id, relativePath, uploadedById),
              { logger, maxAttempts: 3, baseDelay: 200 },
            )
            const eventForThumbs = await this.eventService.getEventByFolderPath(relativePath)
            const thumbMediaFiles = await getMediaFiles(eventPath)
            if (forceThumbs) {
              for (const f of thumbMediaFiles) {
                const eventThumbnailsPath = path.join(
                  this.thumbnailService?.thumbnailsPath || '',
                  year.toString(),
                  eventForThumbs.id.toString(),
                )
                const outputFile = path.join(
                  eventThumbnailsPath,
                  f.isVideo ? f.filename + '.jpg' : f.filename,
                )
                try {
                  await fs.unlink(outputFile)
                } catch (_) {}
              }
            }
            for (const f of thumbMediaFiles) {
              this.thumbnailService?.queueGeneration({
                eventId: eventForThumbs.id,
                year: parseInt(year),
                folderPath: relativePath,
                filename: f.filename,
                isVideo: f.isVideo,
                ...(forceThumbs ? { force: true } : {}),
              })
            }
            logger.thumb(`THUMB ${relativePath}: ${thumbMediaFiles.length} files`)
            if (this.placeRecognitionService && (forcePlaces || this.autodetectPlaces)) {
              this.placeRecognitionService.queueGeneration({
                id: eventForThumbs.id,
                year: parseInt(year),
                folderPath: relativePath,
                isFirstScan: false,
                mode,
                ...(forcePlaces ? { force: true } : {}),
              })
            }
            if (this.faceRecognitionService && (forceFaces || this.autodetectFaces)) {
              this.faceRecognitionService.queueGeneration({
                id: eventForThumbs.id,
                folderPath: relativePath,
                ...(forceFaces ? { force: true } : {}),
              })
            }
          } else {
            if (mode === 'full') {
              const thumbMediaFiles = await getMediaFiles(eventPath)
              if (forceThumbs) {
                for (const f of thumbMediaFiles) {
                  const eventThumbnailsPath = path.join(
                    this.thumbnailService?.thumbnailsPath || '',
                    year.toString(),
                    existingEvent.id.toString(),
                  )
                  const outputFile = path.join(
                    eventThumbnailsPath,
                    f.isVideo ? f.filename + '.jpg' : f.filename,
                  )
                  try {
                    await fs.unlink(outputFile)
                  } catch (err) {
                    /* ignore */
                  }
                }
              }
              for (const f of thumbMediaFiles) {
                this.thumbnailService?.queueGeneration({
                  eventId: existingEvent.id,
                  year: parseInt(year),
                  folderPath: relativePath,
                  filename: f.filename,
                  isVideo: f.isVideo,
                  ...(forceThumbs ? { force: true } : {}),
                })
              }
              logger.thumb(`THUMB ${relativePath}: ${thumbMediaFiles.length} files`)
              await this.eventService.syncEventMedia(existingEvent.id, relativePath, uploadedById)
              if (this.placeRecognitionService && (forcePlaces || this.autodetectPlaces)) {
                this.placeRecognitionService.queueGeneration({
                  id: existingEvent.id,
                  year: parseInt(year),
                  folderPath: relativePath,
                  isFirstScan: false,
                  mode,
                  ...(forcePlaces ? { force: true } : {}),
                })
              }
              if (this.faceRecognitionService && (forceFaces || this.autodetectFaces)) {
                this.faceRecognitionService.queueGeneration({
                  id: existingEvent.id,
                  folderPath: relativePath,
                  ...(forceFaces ? { force: true } : {}),
                })
              }
            }
          }
          return { isNew: false }
        } else {
          const parsed = parseEventFolderName(event, year)
          const mediaFiles = await getMediaFiles(eventPath)
          const settings = this.settingsService ? await this.settingsService.getAllSettings() : null
          const scanAllowedGroupIds = uploadedById ? null : settings?.scanAllowedGroupIds || null
          const eventData = {
            date: parsed.date,
            title: event,
            folderPath: relativePath,
            year: parseInt(year),
            mediaCount: mediaFiles.length,
            lastScannedAt: new Date(),
            allowedGroupIds: scanAllowedGroupIds ? JSON.stringify(scanAllowedGroupIds) : null,
            uploadedById: uploadedById || null,
          }

          const result = await withRetry(() => this.eventService.upsertEvent(eventData), {
            logger,
            maxAttempts: 3,
            baseDelay: 200,
          })
          if (result) {
            const thumbMediaFiles = await getMediaFiles(eventPath)
            if (forceThumbs) {
              for (const f of thumbMediaFiles) {
                const eventThumbnailsPath = path.join(
                  this.thumbnailService?.thumbnailsPath || '',
                  year.toString(),
                  result.id.toString(),
                )
                const outputFile = path.join(
                  eventThumbnailsPath,
                  f.isVideo ? f.filename + '.jpg' : f.filename,
                )
                try {
                  await fs.unlink(outputFile)
                } catch (err) {
                  /* ignore */
                }
              }
            }
            for (const f of thumbMediaFiles) {
              this.thumbnailService?.queueGeneration({
                eventId: result.id,
                year: parseInt(year),
                folderPath: relativePath,
                filename: f.filename,
                isVideo: f.isVideo,
                ...(forceThumbs ? { force: true } : {}),
              })
            }
            logger.thumb(`THUMB ${relativePath}: ${thumbMediaFiles.length} files`)
            await this.eventService.syncEventMedia(result.id, relativePath, uploadedById)
            // Places: new event with GPS files
            if (this.placeRecognitionService && (forcePlaces || this.autodetectPlaces)) {
              this.placeRecognitionService.queueGeneration({
                id: result.id,
                year: parseInt(year),
                folderPath: relativePath,
                isFirstScan: true,
                mode,
                ...(forcePlaces ? { force: true } : {}),
              })
            }
            if (this.faceRecognitionService && (forceFaces || this.autodetectFaces)) {
              this.faceRecognitionService.queueGeneration({
                id: result.id,
                folderPath: relativePath,
                ...(forceFaces ? { force: true } : {}),
              })
            }
          }
          return { isNew: true }
        }
      }
    } catch (eventError) {
      logger.error(`Event error: ${event} - ${eventError.message}`)
    }
    return { isNew: false }
  }

  /**
   * Handle path changes (for WatcherService)
   * @param {string} dirPath
   * @param {string} changeType - 'added' | 'removed'
   */
  async handlePathChanged(dirPath, changeType) {
    const dirName = path.basename(dirPath)
    const yearName = path.basename(path.dirname(dirPath))

    if (!isYearFolder(yearName)) return

    const parsed = parseEventFolderName(dirName, yearName)
    const relativePath = buildEventPath(yearName, dirName)
    logger.scan(`Path ${changeType}: ${dirName}`)

    if (changeType === 'added') {
      const existingEvent = await this.eventService.getEventByFolderPath(relativePath)
      if (existingEvent) {
        logger.scan(`Event exists, queue thumbnails`)
        if (this.thumbnailService) {
          const thumbMediaFiles = await getMediaFiles(dirPath)
          for (const f of thumbMediaFiles) {
            this.thumbnailService.queueGeneration({
              eventId: existingEvent.id,
              year: parseInt(yearName),
              folderPath: relativePath,
              filename: f.filename,
              isVideo: f.isVideo,
            })
          }
          await this.thumbnailService.processQueue()
        }
        if (this.websocketService) this.websocketService.notifyWatcherCycleComplete()
        return
      }

      const eventData = {
        date: parsed.date,
        title: dirName,
        folderPath: relativePath,
        year: parseInt(yearName),
        mediaCount: 0,
        lastScannedAt: new Date(),
      }

      const result = await this.eventService.upsertEvent(eventData)
      if (result) {
        logger.scan(`New event created: ${result.id}`)
        // syncEventMedia already calls queueGeneration for each file
        await this.eventService.syncEventMedia(result.id, relativePath)

        if (this.thumbnailService) {
          await this.thumbnailService.processQueue()
        }
        if (this.placeRecognitionService && this.autodetectPlaces) {
          this.placeRecognitionService.queueGeneration({
            id: result.id,
            year: parseInt(yearName),
            folderPath: relativePath,
            isFirstScan: true,
          })
        }
        if (this.faceRecognitionService && this.autodetectFaces) {
          this.faceRecognitionService.queueGeneration({ id: result.id, folderPath: relativePath })
        }
        const placePromise = this.placeRecognitionService?.isQueueActive()
          ? this.placeRecognitionService.processQueue()
          : null
        const facePromise = this.faceRecognitionService?.isQueueActive()
          ? this.faceRecognitionService.processQueue()
          : null
        if (placePromise) await placePromise
        if (facePromise) await facePromise
        if (this.websocketService) {
          this.websocketService.notifyEventCreated(result)
          this.websocketService.notifyWatcherCycleComplete()
        }
      }
    } else if (changeType === 'removed') {
      const event = await this.eventService.getEventByFolderPath(relativePath)
      if (!event) {
        logger.warn(`Event not found in DB: ${relativePath}`)
        return
      }

      logger.scan(`Removing event: ${event.id}`)

      if (this.thumbnailService) {
        const thumbnailsPath = path.join(
          this.thumbnailService.thumbnailsPath,
          event.year.toString(),
          event.id.toString(),
        )
        try {
          await fs.rm(thumbnailsPath, { recursive: true, force: true })
        } catch (err) {
          logger.warn(`Failed to remove thumbnails: ${err.message}`)
        }
      }

      const exists = await this.eventService.prisma.event.findFirst({
        where: { id: event.id },
        select: { id: true },
      })
      if (!exists) {
        logger.warn(`Event ${event.id} already removed from DB, skipping delete`)
        if (this.websocketService) this.websocketService.notifyEventDeleted(event.id)
        return
      }

      await this.eventService.prisma.event.delete({ where: { id: event.id } })
      if (this.websocketService) this.websocketService.notifyEventDeleted(event.id)
    }
  }
}

module.exports = ScanService
