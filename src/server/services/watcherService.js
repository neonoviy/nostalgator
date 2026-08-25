const fs = require('fs').promises
const chokidar = require('chokidar')
const path = require('path')
const { normalizePath, isMediaFile } = require('../utils/fileUtils')
const logger = require('../utils/logger')

async function safeMove(src, dest) {
  try {
    await fs.rename(src, dest)
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fs.copyFile(src, dest)
      await fs.unlink(src)
    } else {
      throw err
    }
  }
}

/**
 * WatcherService — наблюдение за изменениями файловой системы
 */
class WatcherService {
  constructor(
    scanService,
    thumbnailService,
    prisma,
    websocketService = null,
    placeRecognitionService = null,
  ) {
    this.scanService = scanService
    this.thumbnailService = thumbnailService
    this.prisma = prisma
    this.websocketService = websocketService
    this.placeRecognitionService = placeRecognitionService
    this.watcher = null
    this.importWatcher = null
    this.debounceTimers = new Map()
    this.DEBOUNCE_DELAY = 10000
    this.isRenaming = false
    this.exiftool = require('exiftool-vendored').exiftool
  }

  /**
   * Установить флаг переименования
   * @param {boolean} value
   */
  setRenamingFlag(value) {
    this.isRenaming = value
  }

  /**
   * Запуск наблюдения за папкой Originals
   * @param {string} originalsPath
   */
  startWatching(originalsPath) {
    logger.scan(`Start watching: ${originalsPath}`)
    this.watcher = chokidar.watch(originalsPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
      depth: 3,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    })

    this.watcher
      .on('add', (filePath) => this.handleFileAdded(filePath))
      .on('unlink', (filePath) => this.handleFileRemoved(filePath))
      .on('addDir', (dirPath) => this.handleDirectoryAdded(dirPath))
      .on('unlinkDir', (dirPath) => this.handleDirectoryRemoved(dirPath))
      .on('error', (error) => logger.error(`Watch error: ${error}`))
      .on('ready', () => {
        logger.success('Watcher for Originals is ready')
        this.isRenaming = false
      })
  }

  // Запуск наблюдения за папкой Import
  startWatchingImport(importPath) {
    logger.import(`Start watching Import: ${importPath}`)

    this.importWatcher = chokidar.watch(importPath, {
      ignored: /(^|[\/\\])\../, // Игнорировать скрытые файлы
      persistent: true,
      ignoreInitial: false, // Обрабатывать существующие файлы при старте
      depth: 5, // Глубокая вложенность
      awaitWriteFinish: {
        // Ждём завершения записи
        stabilityThreshold: 2000, // 2 секунды после последнего изменения
        pollInterval: 100,
      },
    })

    // Обработчики событий — перемещаем файлы в Originals
    this.importWatcher
      .on('add', (filePath) => this.handleImportFileAdded(filePath))
      .on('addDir', (dirPath) => this.handleImportDirAdded(dirPath))
      .on('unlinkDir', (dirPath) => logger.import(`Dir removed: ${dirPath}`))
      .on('error', (error) => logger.error(`Import watch error: ${error}`))
      .on('ready', () => {
        logger.success('Watcher for Import is ready')
      })
  }

  // Обработка отдельного файла из Import (файл напрямую в Import, без папки)
  async handleImportFileAdded(filePath) {
    logger.import(`File detected: ${path.basename(filePath)}`)

    // Проверяем, что это медиафайл
    if (!isMediaFile(filePath)) {
      return
    }

    // Проверяем, что файл напрямую в Import (не в подпапке)
    const fileDir = path.dirname(filePath)
    const importBasename = path.basename(fileDir)
    if (importBasename.toLowerCase() !== 'import') {
      // Файл в подпапке — обрабатывается в handleImportDirAdded
      return
    }

    // Используем debounce (вдруг файл ещё копируется)
    this.debounce(`import_file_${filePath}`, async () => {
      try {
        const movedTo = await this.processImportFile(filePath)
        if (movedTo) {
          logger.success(`Imported file: ${path.basename(movedTo)}`)
        }
      } catch (error) {
        logger.error(`Failed to import file ${path.basename(filePath)}`, error.message)
      }
    })
  }

  // Публичный метод для вызова из import.js
  // Обрабатывает все файлы в Import, привязывая userId
  async processImportedFiles(importPath, userId) {
    logger.import(`Processing ${importPath} for user ${userId}`)

    try {
      const entries = await fs.readdir(importPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(importPath, entry.name)

        if (entry.isDirectory()) {
          const files = await this.scanImportDir(fullPath)
          if (files.length > 0) {
            for (const filePath of files) {
              await this.processImportFileWithUser(filePath, userId)
            }
            await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {})
          }
        } else if (entry.isFile() && isMediaFile(fullPath)) {
          await this.processImportFileWithUser(fullPath, userId)
        }
      }
    } catch (error) {
      logger.error(`processImportedFiles error: ${error.message}`)
    }
  }

  // Обработка отдельного файла из Import с привязкой пользователя
  async processImportFileWithUser(filePath, userId) {
    try {
      const movedTo = await this.processImportFile(filePath)
      if (movedTo && this.scanService) {
        const eventPath = this.extractEventPath(movedTo)
        await this.scanService.scanEvent(eventPath, () => {}, 'full', userId)
      }
    } catch (error) {
      logger.error(`Import file failed for ${path.basename(filePath)}: ${error.message}`)
    }
  }

  // Остановка наблюдения
  stopWatching() {
    if (this.watcher) {
      this.watcher.close()
      logger.scan('Watcher stopped')
    }
    if (this.importWatcher) {
      this.importWatcher.close()
    }
  }

  // Остановка наблюдения за Import
  stopWatchingImport() {
    if (this.importWatcher) {
      this.importWatcher.close()
      logger.import('Import watcher stopped')
      this.importWatcher = null
    }
  }

  // Обработка добавления папки в Import
  async handleImportDirAdded(dirPath) {
    // Игнорируем саму папку Import
    const pathBasename = path.basename(dirPath)
    if (pathBasename.toLowerCase() === 'import') return

    logger.import(`Folder detected: ${path.basename(dirPath)}`)

    this.debounce(`import_dir_${dirPath}`, async () => {
      try {
        const files = await this.scanImportDir(dirPath)

        if (files.length === 0) {
          logger.warn(`Empty folder, skipping: ${path.basename(dirPath)}`)
          return
        }

        logger.import(`Processing ${files.length} files from folder...`)

        const movedFiles = []
        for (const filePath of files) {
          try {
            const movedTo = await this.processImportFile(filePath)
            if (movedTo) movedFiles.push(movedTo)
          } catch (error) {
            logger.error(`File import failed: ${path.basename(filePath)}`)
          }
        }

        if (movedFiles.length === files.length) {
          try {
            await fs.rm(dirPath, { recursive: true, force: true })
            logger.success(`Folder removed: ${path.basename(dirPath)}`)
          } catch (error) {
            logger.error(`Folder remove failed: ${path.basename(dirPath)}`)
          }
        }
      } catch (error) {
        logger.error(`Folder processing failed: ${path.basename(dirPath)}`)
      }
    })
  }

  // Сканирование папки Import на наличие медиафайлов (рекурсивно)
  async scanImportDir(dirPath) {
    const files = []

    async function scanDir(currentPath) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)

        if (entry.isDirectory()) {
          await scanDir(fullPath)
        } else if (isMediaFile(fullPath)) {
          files.push(fullPath)
        }
      }
    }

    await scanDir(dirPath)
    return files
  }

  // Обработка отдельного файла из Import
  async processImportFile(filePath) {
    try {
      // Читаем EXIF дату
      const tags = await this.exiftool.read(filePath)

      // Для фронтенда пишем детали, в консоль — только если DEBUG
      const logDetail = (msg) => logger.scanDetail(msg, null)

      logDetail(`EXIF read for ${path.basename(filePath)}`)

      let date

      const dateField = tags.DateTimeOriginal || tags.CreateDate || tags.DateTimeDigitized
      if (dateField) {
        logDetail(`EXIF date found: ${dateField}`)

        if (dateField.year && dateField.month && dateField.day) {
          const year = parseInt(dateField.year)
          const month = parseInt(dateField.month) - 1
          const day = parseInt(dateField.day)
          const hours = parseInt(dateField.hour || 0)
          const minutes = parseInt(dateField.minute || 0)
          const seconds = parseInt(dateField.second || 0)

          date = new Date(year, month, day, hours, minutes, seconds)
          logDetail(`Parsed EXIF date: ${date.toISOString()}`)

          // Корректировка: 00:00-05:00 → предыдущий день
          if (hours >= 0 && hours < 5) {
            date.setDate(date.getDate() - 1)
            logDetail(`Time adjusted (00-05), new date: ${date.toISOString()}`)
          }
        }
      }

      if (!date) {
        const filename = path.basename(filePath)
        logDetail(`No EXIF date, trying filename: ${filename}`)
        const match = filename.match(/(\d{4})(\d{2})(\d{2})/)
        if (match) {
          logDetail(`Date found in filename: ${match[0]}`)
          date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
        }
      }

      if (!date) {
        logDetail(`No date found, using current date`)
        date = new Date()
      }

      logDetail(`Final date for ${path.basename(filePath)}: ${date.toISOString()}`)

      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')

      const folderFormat = process.env.FOLDER_FORMAT || 'MM.DD'
      let folderName
      switch (folderFormat) {
        case 'YYYY-MM-DD':
          folderName = `${year}-${month}-${day}`
          break
        case 'YYYY.MM.DD':
          folderName = `${year}.${month}.${day}`
          break
        default:
          folderName = `${month}.${day}`
      }

      const originalsPath = process.env.ORIGINALS_PATH || './Originals'
      const yearPath = path.join(originalsPath, year.toString())
      const folderPath = path.join(yearPath, folderName)

      await fs.mkdir(yearPath, { recursive: true })
      await fs.mkdir(folderPath, { recursive: true })

      const fileName = path.basename(filePath)
      const destPath = path.join(folderPath, fileName)

      let finalDestPath = destPath
      if (
        await fs
          .access(destPath)
          .then(() => true)
          .catch(() => false)
      ) {
        const name = path.parse(fileName).name
        const ext = path.extname(fileName)
        const newFileName = `${name}_${Date.now()}${ext}`
        finalDestPath = path.join(folderPath, newFileName)
      }

      await safeMove(filePath, finalDestPath)
      return finalDestPath
    } catch (error) {
      logger.error(`Import process failed for ${path.basename(filePath)}: ${error.message}`)
      throw error
    }
  }

  // Debounce для событий
  debounce(eventKey, callback) {
    if (this.debounceTimers.has(eventKey)) {
      clearTimeout(this.debounceTimers.get(eventKey))
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(eventKey)
      callback()
    }, this.DEBOUNCE_DELAY)

    this.debounceTimers.set(eventKey, timer)
    logger.scanDetail(`Debounce set for ${eventKey}`, null)
  }

  // Обработка добавления файла
  async handleFileAdded(filePath) {
    if (!isMediaFile(filePath)) return

    const eventPath = this.extractEventPath(filePath)

    this.debounce(`file_${eventPath}`, async () => {
      const event = await this.findEventByFilePath(filePath)

      if (event) {
        logger.scan(`Updating event ${event.id} (file added)`)
        await this.scanService.eventService.syncEventMedia(event.id, event.folderPath)
        if (this.thumbnailService) {
          await this.thumbnailService.processQueue()
        }

        // Places: GPS могли измениться
        if (this.placeRecognitionService && this.scanService.autodetectPlaces) {
          this.placeRecognitionService.queueGeneration({
            id: event.id,
            year: event.year,
            folderPath: event.folderPath,
            isFirstScan: false,
          })
        }
        if (this.scanService.faceRecognitionService && this.scanService.autodetectFaces) {
          this.scanService.faceRecognitionService.queueGeneration({
            id: event.id,
            folderPath: event.folderPath,
          })
        }
      } else {
        logger.scan(`File in new folder, scanning event...`)
        const newEvent = await this.scanService.scanEvent(eventPath)
        if (!newEvent) {
          if (this.websocketService) this.websocketService.notifyWatcherCycleComplete()
          return
        }

        // Places: новое событие
        if (this.placeRecognitionService && this.scanService.autodetectPlaces) {
          this.placeRecognitionService.queueGeneration({
            id: newEvent.id,
            year: newEvent.year,
            folderPath: newEvent.folderPath,
            isFirstScan: true,
          })
        }
        if (this.scanService.faceRecognitionService && this.scanService.autodetectFaces) {
          this.scanService.faceRecognitionService.queueGeneration({
            id: newEvent.id,
            folderPath: newEvent.folderPath,
          })
        }
      }

      // Start both recognition queues in parallel if not already running
      const placePromise = this.placeRecognitionService?.isQueueActive()
        ? this.placeRecognitionService.processQueue()
        : null
      const facePromise = this.scanService.faceRecognitionService?.isQueueActive()
        ? this.scanService.faceRecognitionService.processQueue()
        : null
      if (placePromise) await placePromise
      if (facePromise) await facePromise

      if (this.websocketService) this.websocketService.notifyWatcherCycleComplete()
    })
  }

  // Обработка удаления файла
  async handleFileRemoved(filePath) {
    if (!isMediaFile(filePath)) return

    this.debounce(`unlink_${filePath}`, async () => {
      const event = await this.findEventByFilePath(filePath)
      if (event) {
        logger.scan(`Updating event ${event.id} (file removed)`)
        await this.scanService.eventService.syncEventMedia(event.id, event.folderPath)
      }
    })
  }

  // Обработка добавления папки
  async handleDirectoryAdded(dirPath) {
    if (this.isRenaming) {
      logger.warn(`Ignoring directory add (renaming in progress)`)
      return
    }

    logger.scan(`Directory added: ${path.basename(dirPath)}`)

    this.debounce(`addDir_${dirPath}`, async () => {
      await this.scanService.handlePathChanged(dirPath, 'added')
    })
  }

  // Обработка удаления папки
  async handleDirectoryRemoved(dirPath) {
    if (this.isRenaming) {
      logger.warn(`Ignoring directory removal (renaming in progress)`)
      return
    }
    logger.scan(`Directory removed: ${path.basename(dirPath)}`)
    await this.scanService.handlePathChanged(dirPath, 'removed')
  }

  // Поиск события по пути файла — SQL запрос через Prisma
  async findEventByFilePath(filePath) {
    try {
      const normalizedFilePath = normalizePath(filePath)
      const originalsPath = normalizePath(this.scanService.originalsPath)

      // Вычисляем относительный путь от Originals
      let relativePath = normalizedFilePath
      if (normalizedFilePath.startsWith(originalsPath)) {
        relativePath = normalizedFilePath.slice(originalsPath.length).replace(/^[/\\]/, '')
      }

      // Ищем событие, папка которого является префиксом пути файла
      // folderPath хранится как "YYYY/MM.DD Название", ищем startsWith
      const events = await this.prisma.event.findMany({
        where: {
          folderPath: {
            startsWith: relativePath.split(/[/\\]/).slice(0, 2).join('/'),
          },
        },
      })

      // Точная проверка: файл должен быть внутри папки события
      // Оба пути нормализованы (через normalizePath), поэтому используем '/'
      for (const event of events) {
        const eventFullPath = normalizePath(path.join(originalsPath, event.folderPath))

        if (normalizedFilePath.startsWith(eventFullPath + '/')) {
          return event
        }
      }

      return null
    } catch (error) {
      logger.error('Failed to find event by file path', error)
      return null
    }
  }

  // Извлечение пути к папке события из пути файла
  extractEventPath(filePath) {
    const parts = filePath.split(path.sep)
    if (parts.length >= 3) {
      return parts.slice(0, -1).join(path.sep)
    }
    return filePath
  }
}

module.exports = WatcherService
