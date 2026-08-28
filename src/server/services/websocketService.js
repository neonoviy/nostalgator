const WebSocket = require('ws')
const logger = require('../utils/logger')

/**
 * WebSocketService — real-time уведомления для клиентов
 */
class WebSocketService {
  constructor() {
    this.wss = null
    this.clients = new Set()
    this.isServerReady = false // Флаг готовности сервера (для новых подключений)
  }

  /**
   * Инициализация WebSocket сервера
   * @param {Object} server - HTTP сервер
   * @param {Function} getScanStatus - функция получения статуса сканирования
   * @param {Function} getThumbnailStatus - функция получения статуса миниатюр
   * @param {Function} getFaceStatus - функция получения статуса распознавания лиц
   * @param {Function} getPlaceStatus - функция получения статуса распознавания мест
   */
  setupWebSocket(
    server,
    getScanStatus = null,
    getThumbnailStatus = null,
    getFaceStatus = null,
    getPlaceStatus = null,
  ) {
    this.wss = new WebSocket.Server({ server, path: '/ws' })
    this.getScanStatus = getScanStatus
    this.getThumbnailStatus = getThumbnailStatus
    this.getFaceStatus = getFaceStatus
    this.getPlaceStatus = getPlaceStatus

    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws)

      // Если сервер уже готов — сразу сообщаем новому клиенту
      if (this.isServerReady) {
        this._safeSend(ws, { type: 'server:ready', data: {} })
      }

      // 🔑 Отправляем текущее состояние процессов при подключении
      if (this.getScanStatus && this.getThumbnailStatus) {
        const isScanning = this.getScanStatus()
        const thumbStatus = this.getThumbnailStatus()
        const faceStatus = this.getFaceStatus ? this.getFaceStatus() : null

        if (isScanning) {
          this._safeSend(ws, {
            type: 'scan:process-changed',
            data: { process: 'scanning', active: true },
          })
        }
        if (thumbStatus && thumbStatus.isActive) {
          this._safeSend(ws, {
            type: 'scan:process-changed',
            data: {
              process: 'thumbnails',
              active: true,
              queueLength: thumbStatus.queueLength || 0,
              processingCount: thumbStatus.processingCount || 0,
            },
          })
        }
        if (faceStatus && faceStatus.isActive) {
          this._safeSend(ws, {
            type: 'scan:process-changed',
            data: {
              process: 'faces',
              active: true,
              queueLength: faceStatus.queueLength || 0,
              processingCount: faceStatus.processingCount || 0,
            },
          })
        }
        if (this.getPlaceStatus) {
          const placeStatus = this.getPlaceStatus()
          if (placeStatus && placeStatus.isActive) {
            this._safeSend(ws, {
              type: 'scan:process-changed',
              data: {
                process: 'places',
                active: true,
                queueLength: placeStatus.queueLength || 0,
                processingCount: placeStatus.processingCount || 0,
              },
            })
          }
        }
      }

      ws.on('close', () => {
        this.clients.delete(ws)
      })

      ws.on('error', (error) => {
        logger.error('WebSocket error', error)
        this.clients.delete(ws)
      })
    })

    logger.info(`WebSocket server ready on port ${server.address()?.port || 'http'}`)
  }

  /**
   * Рассылка сообщения всем клиентам
   * @param {string} type - тип события
   * @param {Object} data
   */
  broadcast(type, data = {}) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() })
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message)
    })
  }

  /** Безопасная отправка одному клиенту */
  _safeSend(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...message, timestamp: Date.now() }))
    }
  }

  // --- События ---

  /** @param {Object} event */
  notifyEventCreated(event) {
    this.broadcast('event:created', { event })
  }

  /** @param {number} eventId */
  notifyEventDeleted(eventId) {
    this.broadcast('event:deleted', { eventId })
  }

  notifyEventsChanged(source = 'system') {
    this.broadcast('events:changed', { source })
  }

  // --- Готовность сервера ---

  /** Отметить что сервер готов (вызывается из index.js после инициализации сервисов) */
  markServerReady() {
    this.isServerReady = true
    this.broadcast('server:ready', {})
  }

  // --- Сканирование ---

  /**
   * Изменение процесса сканирования
   * @param {string} process - 'scanning' | 'thumbnails' | 'faces' | 'places'
   * @param {boolean} active
   * @param {number} queueLength
   * @param {number} processingCount
   */
  notifyScanProcessChanged(process, active, queueLength = 0, processingCount = 0) {
    this.broadcast('scan:process-changed', { process, active, queueLength, processingCount })
  }

  // Уведомление о завершении цикла обработки вотчера (файлы + миниатюры готовы)
  notifyWatcherCycleComplete() {
    logger.info('Watcher cycle completed')
    this.broadcast('watcher:cycle-complete', {})
  }

  /**
   * Уведомление о папках, обнаруженных на диске, но ещё не отсканированных.
   * @param {string[]} folders - относительные пути (year/event)
   */
  notifyPendingFolders(folders = []) {
    this.broadcast('scan:pending-folders', { folders })
  }

  /**
   * Уведомление о прогрессе распознавания лиц для конкретного события
   * @param {number} eventId
   * @param {Object} data - { phase, ...phase-specific fields }
   *   phase: 'detecting' | 'matching' | 'done' | 'error'
   *   detecting: { imageCount, chunkCount }
   *   matching: { faceCount, knownPersons }
   *   done: { facesDetected, newPersons, matchedPersons, skipped }
   *   error: { error }
   */
  notifyFaceEventProgress(eventId, data) {
    this.broadcast('face:event-progress', { eventId, ...data })
  }
}

module.exports = WebSocketService
