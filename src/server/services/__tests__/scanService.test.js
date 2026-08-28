const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('path')

// ==================== Хелперы ====================

function createMockEventService() {
  return {
    getEventByFolderPath: async () => null,
    upsertEvent: async (data) => ({ id: 1, ...data }),
    syncEventMedia: async () => 5, // mock: returns mediaCount
    prisma: {
      event: {
        update: async (data) => data.data,
        delete: async () => ({}),
        findFirst: async () => ({}),
      },
    },
  }
}

function createMockThumbnailService() {
  return {
    queue: [],
    thumbnailsPath: '/fake/Thumbnails',
    queueGeneration: async () => {},
    processQueue: async () => {},
  }
}

function createMockWebsocketService() {
  return {
    notifyScanProcessChanged: () => {},
    notifyWatcherCycleComplete: () => {},
    notifyEventCreated: () => {},
    notifyEventDeleted: () => {},
    notifyPendingFolders: () => {},
  }
}

// ==================== handlePathChanged ====================

describe('ScanService.handlePathChanged', () => {
  it('должен создавать событие при added', async () => {
    const eventService = createMockEventService()
    let upsertedData = null
    eventService.upsertEvent = async (data) => {
      upsertedData = data
      return { id: 1, ...data }
    }

    // Динамически загружаем ScanService с моком fs
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true, mtimeMs: 1000 }),
      rm: async () => {},
    }

    // Мокаем fs перед require
    const Module = require('module')
    const originalResolve = Module._resolveFilename
    const originalFsModule = require.cache[require.resolve('fs')]

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]

    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(
      eventService,
      '/fake/Originals',
      createMockThumbnailService(),
      createMockWebsocketService(),
    )

    await svc.handlePathChanged('/fake/Originals/2026/01.07 New Event', 'added')

    assert.strictEqual(upsertedData.folderPath, '2026/01.07 New Event')
    assert.strictEqual(upsertedData.year, 2026)

    // Восстанавливаем
    if (originalFsModule) require.cache[require.resolve('fs')] = originalFsModule
    delete require.cache[require.resolve('../scanService')]
  })

  it('должен удалять событие при removed', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    eventService.getEventByFolderPath = async () => ({
      id: 1,
      folderPath: '2026/01.07 Old Event',
      title: 'Old Event',
      year: 2026,
    })
    let deleted = false
    eventService.prisma.event.delete = async () => {
      deleted = true
      return {}
    }

    let websocketNotified = false
    const websocketService = createMockWebsocketService()
    websocketService.notifyEventDeleted = () => {
      websocketNotified = true
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(
      eventService,
      '/fake/Originals',
      createMockThumbnailService(),
      websocketService,
    )
    await svc.handlePathChanged('/fake/Originals/2026/01.07 Old Event', 'removed')

    assert.strictEqual(deleted, true)
    assert.strictEqual(websocketNotified, true)

    delete require.cache[require.resolve('../scanService')]
  })

  it('должен обновлять mediaCount при added', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    let syncEventMediaCalled = false
    eventService.upsertEvent = async (data) => ({ id: 1, ...data })
    eventService.syncEventMedia = async () => {
      syncEventMediaCalled = true
      return 0
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(
      eventService,
      '/fake/Originals',
      createMockThumbnailService(),
      createMockWebsocketService(),
    )
    await svc.handlePathChanged('/fake/Originals/2026/01.07 Test', 'added')

    assert.strictEqual(syncEventMediaCalled, true)

    delete require.cache[require.resolve('../scanService')]
  })

  it('должен игнорировать папки не в году', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    let upsertCalled = false
    eventService.upsertEvent = async () => {
      upsertCalled = true
      return { id: 1 }
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(eventService, '/fake/Originals', null, null)
    await svc.handlePathChanged('/fake/Originals/НеГод/SomeFolder', 'added')

    assert.strictEqual(upsertCalled, false)

    delete require.cache[require.resolve('../scanService')]
  })

  it('должен обрабатывать очередь миниатюр если событие уже существует', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true }),
      rm: async () => {},
    }

    let queueProcessed = false
    const eventService = createMockEventService()
    eventService.getEventByFolderPath = async () => ({
      id: 1,
      folderPath: '2026/01.07 Test',
      title: 'Test',
      year: 2026,
    })
    const thumbnailService = createMockThumbnailService()
    thumbnailService.processQueue = async () => {
      queueProcessed = true
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(eventService, '/fake/Originals', thumbnailService, null)
    await svc.handlePathChanged('/fake/Originals/2026/01.07 Test', 'added')

    assert.strictEqual(queueProcessed, true)

    delete require.cache[require.resolve('../scanService')]
  })
})

// ==================== scanEvent логика ====================

describe('ScanService scanEvent логика', () => {
  it('должен создавать новое событие для неизвестной папки', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true, mtimeMs: 1000 }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    let upsertedData = null
    eventService.upsertEvent = async (data) => {
      upsertedData = data
      return { id: 1, ...data }
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(eventService, '/fake/Originals', createMockThumbnailService(), null)
    // Используем path.join для правильного разделителя
    const eventPath = path.join('/fake/Originals', '2026', '01.07 Test')
    const result = await svc.scanEvent(eventPath)

    assert.strictEqual(result.isNew, true)
    assert.strictEqual(upsertedData.folderPath, '2026/01.07 Test')
    assert.strictEqual(upsertedData.year, 2026)

    delete require.cache[require.resolve('../scanService')]
  })

  it('должен перечитывать данные файлов (syncEventMedia) для существующего события при incremental-скане даже без изменения mtime папки', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true, mtimeMs: 500 }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    eventService.getEventByFolderPath = async () => ({
      id: 1,
      folderPath: '2026/01.07 Test',
      title: 'Test',
      date: new Date('2026-01-07'),
      lastScannedAt: new Date(Date.now() - 1000),
      mediaCount: 5,
    })
    let syncEventMediaCalled = false
    eventService.syncEventMedia = async () => {
      syncEventMediaCalled = true
      return 5
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(eventService, '/fake/Originals', createMockThumbnailService(), null)
    const eventPath = path.join('/fake/Originals', '2026', '01.07 Test')
    const result = await svc.scanEvent(eventPath, () => {}, 'incremental')

    assert.strictEqual(result.isNew, false)
    assert.strictEqual(syncEventMediaCalled, true)

    delete require.cache[require.resolve('../scanService')]
  })

  it('должен обновлять lastScannedAt при проверке существующего события', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true, mtimeMs: 500 }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    eventService.getEventByFolderPath = async () => ({
      id: 1,
      folderPath: '2026/01.07 Test',
      title: 'Test',
      date: new Date('2026-01-07'),
      lastScannedAt: new Date(Date.now() - 1000),
      mediaCount: 5,
    })
    let updatedLastScannedAt = null
    eventService.prisma.event.update = async (data) => {
      updatedLastScannedAt = data.data.lastScannedAt
      return data.data
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(eventService, '/fake/Originals', createMockThumbnailService(), null)
    const eventPath = path.join('/fake/Originals', '2026', '01.07 Test')
    await svc.scanEvent(eventPath, () => {}, 'incremental')

    assert.ok(updatedLastScannedAt instanceof Date)

    delete require.cache[require.resolve('../scanService')]
  })

  it('должен пропускать существующее событие при onlyNew (старт приложения)', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => true, mtimeMs: 500 }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    eventService.getEventByFolderPath = async () => ({
      id: 1,
      folderPath: '2026/01.07 Test',
      title: 'Test',
      date: new Date('2026-01-07'),
      lastScannedAt: new Date(Date.now() - 1000),
      mediaCount: 5,
    })
    let syncEventMediaCalled = false
    eventService.syncEventMedia = async () => {
      syncEventMediaCalled = true
      return 5
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(eventService, '/fake/Originals', createMockThumbnailService(), null)
    const eventPath = path.join('/fake/Originals', '2026', '01.07 Test')
    const result = await svc.scanEvent(eventPath, () => {}, 'incremental', null, {}, new Set(), {
      onlyNew: true,
    })

    assert.strictEqual(result.isNew, false)
    assert.strictEqual(syncEventMediaCalled, false)

    delete require.cache[require.resolve('../scanService')]
  })
})

// ==================== scanYear логика ====================

describe('ScanService scanYear логика', () => {
  it('должен сканировать события в папке года', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async (p) => (p.includes('2026') ? ['01.07 Test', '02.14 Party'] : []),
      stat: async () => ({ isDirectory: () => true, mtimeMs: 1000 }),
      rm: async () => {},
    }

    const eventService = createMockEventService()
    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(eventService, '/fake/Originals', createMockThumbnailService(), null)
    const result = await svc.scanYear('2026')

    assert.strictEqual(result.scanned, 2)
    assert.strictEqual(result.added, 2)

    delete require.cache[require.resolve('../scanService')]
  })

  it('должен обрабатывать ошибки папки года', async () => {
    const mockFs = {
      access: async () => {},
      readdir: async () => [],
      stat: async () => {
        throw new Error('Access denied')
      },
      rm: async () => {},
    }

    delete require.cache[require.resolve('fs')]
    delete require.cache[require.resolve('../scanService')]
    require.cache[require.resolve('fs')] = {
      id: require.resolve('fs'),
      filename: require.resolve('fs'),
      loaded: true,
      exports: { promises: mockFs },
    }

    const ScanService = require('../scanService')
    const svc = new ScanService(createMockEventService(), '/fake/Originals', null, null)
    const result = await svc.scanYear('2026', () => {})

    assert.strictEqual(result.scanned, 0)
    assert.strictEqual(result.added, 0)

    delete require.cache[require.resolve('../scanService')]
  })
})
