const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('fs').promises
const path = require('path')
const os = require('os')

const ThumbnailService = require('../thumbnailService')

let tmpDir
let thumbDir

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnails-test-'))
  thumbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbs-test-'))
}

async function cleanup() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
  if (thumbDir) await fs.rm(thumbDir, { recursive: true, force: true })
}

function createService(thumbnailsPath = thumbDir, originalsPath = tmpDir, websocketService = null) {
  const svc = new ThumbnailService(thumbnailsPath, originalsPath, websocketService)
  return svc
}

// ==================== queueGeneration (file-level) ====================

describe('ThumbnailService.queueGeneration (file-level)', () => {
  beforeEach(setup)
  afterEach(cleanup)

  it('должен добавлять файл в очередь и обрабатывать', async () => {
    const svc = createService()
    svc.generateFileThumbnail = async () => {}

    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'photo.jpg',
      isVideo: false,
    })
    await svc.processQueue()

    assert.strictEqual(svc.queue.length, 0)
  })

  it('должен уведомлять WebSocket о начале генерации', () => {
    let notified = false
    const websocketService = {
      notifyScanProcessChanged: () => {
        notified = true
      },
    }

    const svc = createService(thumbDir, tmpDir, websocketService)
    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'photo.jpg',
      isVideo: false,
    })

    assert.strictEqual(notified, true)
  })

  it('должен запускать фоновый цикл автоматически', () => {
    const svc = createService()
    assert.strictEqual(svc._backgroundRunning, false)
    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'photo.jpg',
      isVideo: false,
    })
    assert.strictEqual(svc._backgroundRunning, true)
  })
})

// ==================== isQueueActive ====================

describe('ThumbnailService.isQueueActive', () => {
  it('должен возвращать true если очередь не пуста', () => {
    const svc = createService()
    svc.queue.push({ eventId: 1, filename: 'photo.jpg' })
    assert.strictEqual(svc.isQueueActive(), true)
  })

  it('должен возвращать false если очередь пуста', () => {
    const svc = createService()
    assert.strictEqual(svc.isQueueActive(), false)
  })

  it('должен возвращать true если идёт обработка', () => {
    const svc = createService()
    svc.processingCount = 1
    assert.strictEqual(svc.isQueueActive(), true)
  })
})

// ==================== processQueue ====================

describe('ThumbnailService.processQueue', () => {
  it('должен сразу выходить если очередь пуста', async () => {
    const svc = createService()
    await svc.processQueue()
    assert.strictEqual(svc.isProcessing, false)
  })

  it('должен запускать фоновый цикл если очередь есть а цикл не запущен', async () => {
    const svc = createService()
    svc.queue.push({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'photo.jpg',
      isVideo: false,
    })

    // processQueue должен запустить _ensureBackgroundRunning
    const promise = svc.processQueue()
    assert.strictEqual(svc._backgroundRunning, true)
    assert.ok(promise instanceof Promise)
    assert.strictEqual(svc.waiters.length, 1)

    // Очистим чтобы тест не завис
    svc.waiters.forEach((r) => r())
  })

  it('должен возвращать Promise для ожидающих', async () => {
    const svc = createService()
    svc._backgroundRunning = true

    const promise = svc.processQueue()
    assert.ok(promise instanceof Promise)
    assert.strictEqual(svc.waiters.length, 1)

    svc.waiters[0]()
  })
})

// ==================== sleep ====================

describe('ThumbnailService.sleep', () => {
  it('должен создавать задержку', async () => {
    const svc = createService()
    const start = Date.now()
    await svc.sleep(50)
    const elapsed = Date.now() - start

    assert.ok(elapsed >= 45, `Задержка должна быть ~50ms, прошло ${elapsed}ms`)
  })
})

// ==================== queue state management ====================

describe('ThumbnailService queue state', () => {
  it('MAX_CONCURRENT должен быть равен 2', () => {
    const svc = createService()
    assert.strictEqual(svc.MAX_CONCURRENT, 2)
  })

  it('должен обрабатывать элементы, добавленные во время ожидания завершения текущих', async () => {
    const svc = createService()
    let processed = []
    svc.generateFileThumbnail = async (item) => {
      processed.push(item.filename)
    }

    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'a.jpg',
      isVideo: false,
    })
    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'b.jpg',
      isVideo: false,
    })

    await svc.processQueue()
    assert.strictEqual(svc.queue.length, 0)
    assert.strictEqual(svc.isQueueActive(), false)
    assert.deepStrictEqual(processed, ['a.jpg', 'b.jpg'])
  })

  it('должен обрабатывать новые элементы, добавленные пока идут задачи', async () => {
    const svc = createService()
    const order = []
    svc.generateFileThumbnail = async (item) => {
      order.push(item.filename)
      if (item.filename === 'a.jpg') {
        svc.queueGeneration({
          eventId: 1,
          year: 2026,
          folderPath: '2026/01.07 Test',
          filename: 'c.jpg',
          isVideo: false,
        })
      }
    }

    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'a.jpg',
      isVideo: false,
    })
    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'b.jpg',
      isVideo: false,
    })

    await svc.processQueue()
    assert.strictEqual(svc.queue.length, 0)
    assert.strictEqual(svc.isQueueActive(), false)
    assert.ok(order.includes('c.jpg'), 'новый элемент должен быть обработан')
  })
})

// ==================== per-folder completion log ([THUMB]) ====================

describe('ThumbnailService per-folder completion log', () => {
  let thumbCalls

  beforeEach(() => {
    thumbCalls = []
    const logger = require('../../utils/logger')
    logger.thumb = (msg) => thumbCalls.push(msg)
  })

  afterEach(() => {
    const logger = require('../../utils/logger')
    delete logger.thumb
  })

  it('должен логировать [THUMB] только после завершения генерации папки', async () => {
    const svc = createService()
    svc.generateFileThumbnail = async () => {}

    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'a.jpg',
      isVideo: false,
    })
    svc.queueGeneration({
      eventId: 1,
      year: 2026,
      folderPath: '2026/01.07 Test',
      filename: 'b.jpg',
      isVideo: false,
    })

    // Во время постановки в очередь лога быть не должно
    assert.strictEqual(thumbCalls.length, 0)

    await svc.processQueue()

    assert.strictEqual(thumbCalls.length, 1)
    assert.strictEqual(thumbCalls[0], '2026/01.07 Test: 2 files')
  })

  it('должен логировать [THUMB] отдельно для каждой папки', async () => {
    const svc = createService()
    svc.generateFileThumbnail = async () => {}

    svc.queueGeneration({ eventId: 1, year: 2026, folderPath: '2026/A', filename: 'a.jpg' })
    svc.queueGeneration({ eventId: 2, year: 2026, folderPath: '2026/B', filename: 'b.jpg' })

    await svc.processQueue()

    assert.strictEqual(thumbCalls.length, 2)
    assert.ok(thumbCalls.includes('2026/A: 1 files'))
    assert.ok(thumbCalls.includes('2026/B: 1 files'))
  })
})

// ==================== getThumbnailsForEvent ====================

describe('ThumbnailService.getThumbnailsForEvent', () => {
  beforeEach(setup)
  afterEach(cleanup)

  it('должен возвращать миниатюры для видео с суффиксом .jpg', async () => {
    const svc = createService()
    const eventThumbDir = path.join(thumbDir, '2026', '1')
    await fs.mkdir(eventThumbDir, { recursive: true })
    await fs.writeFile(path.join(eventThumbDir, 'video.mp4.jpg'), Buffer.from('fake thumb', 'utf8'))

    const mockPrisma = {
      media: {
        findMany: async () => [{ id: 1, filename: 'video.mp4', clusterId: null, capturedAt: new Date('2025-07-28T12:00:00Z') }],
      },
      face: { findMany: async () => [] },
    }

    const result = await svc.getThumbnailsForEvent(1, 2026, undefined, mockPrisma)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].filename, 'video.mp4')
    assert.ok(result[0].url.includes('video.mp4.jpg'))
    assert.deepStrictEqual(result[0].capturedAt, new Date('2025-07-28T12:00:00Z'))
  })

  it('должен возвращать миниатюры для изображений без суффикса', async () => {
    const svc = createService()
    const eventThumbDir = path.join(thumbDir, '2026', '1')
    await fs.mkdir(eventThumbDir, { recursive: true })
    await fs.writeFile(path.join(eventThumbDir, 'photo.jpg'), Buffer.from('fake thumb', 'utf8'))

    const mockPrisma = {
      media: {
        findMany: async () => [{ id: 1, filename: 'photo.jpg', clusterId: null, capturedAt: new Date('2025-07-28T12:00:00Z') }],
      },
      face: { findMany: async () => [] },
    }

    const result = await svc.getThumbnailsForEvent(1, 2026, undefined, mockPrisma)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].filename, 'photo.jpg')
    assert.ok(result[0].url.includes('photo.jpg'))
    assert.ok(!result[0].url.includes('.jpg.jpg'))
    assert.deepStrictEqual(result[0].capturedAt, new Date('2025-07-28T12:00:00Z'))
  })

  it('должен игнорировать медиафайлы без миниатюр', async () => {
    const svc = createService()

    const mockPrisma = {
      media: {
        findMany: async () => [{ id: 1, filename: 'missing.mp4', clusterId: null, capturedAt: null }],
      },
    }

    const result = await svc.getThumbnailsForEvent(1, 2026, undefined, mockPrisma)

    assert.strictEqual(result.length, 0)
  })
})
