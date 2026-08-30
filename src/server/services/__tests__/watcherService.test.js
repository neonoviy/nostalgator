const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const WatcherService = require('../watcherService')

function createMockScanService() {
  return {
    originalsPath: '/fake/Originals',
    handlePathChanged: async () => {},
    eventService: {
      syncEventMedia: async () => {},
    },
    faceRecognitionService: null,
    autodetectFaces: false,
    autodetectPlaces: false,
  }
}

function createMockThumbnailService() {
  return {
    processQueue: async () => {},
  }
}

function createMockPrisma() {
  return {
    event: {
      findMany: async () => [],
    },
  }
}

function createWatcherService() {
  const service = new WatcherService(
    createMockScanService(),
    createMockThumbnailService(),
    createMockPrisma(),
    null,
    null,
  )
  service.isEnabled = true
  return service
}

describe('WatcherService rename flag', () => {
  let service

  beforeEach(() => {
    service = createWatcherService()
  })

  it('handleDirectoryRemoved должен подавляться при активном флаге переименования', async () => {
    service.setRenamingFlag(true)
    let scanCalled = false
    service.scanService.handlePathChanged = async () => {
      scanCalled = true
    }

    await service.handleDirectoryRemoved('/fake/Originals/2026/Test Event')

    assert.strictEqual(scanCalled, false, 'scan не должен вызываться во время переименования')
  })

  it('handleDirectoryAdded должен подавляться при активном флаге переименования', async () => {
    service.setRenamingFlag(true)
    let scanCalled = false
    service.scanService.handlePathChanged = async () => {
      scanCalled = true
    }

    await service.handleDirectoryAdded('/fake/Originals/2026/Test Event')

    assert.strictEqual(scanCalled, false, 'scan не должен вызываться во время переименования')
  })

  it('handlePathRemoved должен подавляться при активном флаге переименования', async () => {
    service.setRenamingFlag(true)
    let dirRemovedCalled = false
    service.scanService.handlePathChanged = async () => {
      dirRemovedCalled = true
    }

    await service.handlePathRemoved('/fake/Originals/2026/Test Event')

    assert.strictEqual(dirRemovedCalled, false, 'удаление папки не должно обрабатываться во время переименования')
  })

  it('handleFileRemoved должен подавляться при активном флаге переименования', async () => {
    service.setRenamingFlag(true)
    let syncCalled = false
    service.scanService.eventService.syncEventMedia = async () => {
      syncCalled = true
    }
    service.scanService.handlePathChanged = async () => {}

    await service.handleFileRemoved('/fake/Originals/2026/Test Event/photo.jpg')

    assert.strictEqual(syncCalled, false, 'syncEventMedia не должна вызываться во время переименования')
  })

  it('обработка должна возобновляться после сброса флага', async () => {
    service.setRenamingFlag(true)
    let scanCalled = false
    service.scanService.handlePathChanged = async () => {
      scanCalled = true
    }

    await service.handleDirectoryRemoved('/fake/Originals/2026/Test Event')
    assert.strictEqual(scanCalled, false)

    service.setRenamingFlag(false)
    await service.handleDirectoryRemoved('/fake/Originals/2026/Test Event')
    assert.strictEqual(scanCalled, true, 'после сброса флага обработка должна возобновиться')
  })
})
