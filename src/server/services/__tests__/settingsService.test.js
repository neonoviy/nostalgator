const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const SettingsService = require('../settingsService')

// ==================== Моки ====================

function createMockPrisma() {
  const _store = { setting: null }

  return {
    setting: {
      findUnique: async ({ where }) => {
        if (where.id === 1) return _store.setting
        return null
      },
      upsert: async ({ create, update, where }) => {
        if (_store.setting) {
          _store.setting = { ..._store.setting, ...update, updatedAt: new Date() }
        } else {
          _store.setting = { id: 1, ...create }
        }
        return _store.setting
      },
    },
    _seed: (setting) => {
      _store.setting = setting
    },
    _getStore: () => _store,
  }
}

function createService(prisma) {
  const service = new SettingsService({ prisma })
  return service
}

// ==================== getAllSettings ====================

describe('SettingsService.getAllSettings', () => {
  it('должен возвращать дефолтные настройки если настройка не найдена', async () => {
    const prisma = createMockPrisma()
    const service = createService(prisma)

    const result = await service.getAllSettings()

    assert.strictEqual(result.originalsWatchEnabled, false)
    assert.strictEqual(result.importWatchEnabled, false)
    assert.strictEqual(result.theme, 'light')
    assert.strictEqual(result.originalsPath, '')
    assert.strictEqual(result.thumbnailsPath, '')
  })

  it('должен возвращать сохранённые настройки', async () => {
    const prisma = createMockPrisma()
    prisma._seed({
      id: 1,
      originalsPath: '/data/Originals',
      thumbnailsPath: '/data/Thumbnails',
      originalsWatchEnabled: true,
      importWatchEnabled: true,
      theme: 'dark',
    })

    const service = createService(prisma)
    const result = await service.getAllSettings()

    assert.strictEqual(result.originalsWatchEnabled, true)
    assert.strictEqual(result.importWatchEnabled, true)
    assert.strictEqual(result.theme, 'dark')
    assert.strictEqual(result.originalsPath, '/data/Originals')
    assert.strictEqual(result.thumbnailsPath, '/data/Thumbnails')
  })

  it('должен использовать fallback при null значениях', async () => {
    const prisma = createMockPrisma()
    prisma._seed({
      id: 1,
      originalsPath: null,
      thumbnailsPath: null,
      originalsWatchEnabled: null,
      importWatchEnabled: null,
      theme: null,
    })

    const service = createService(prisma)
    const result = await service.getAllSettings()

    assert.strictEqual(result.originalsWatchEnabled, false)
    assert.strictEqual(result.importWatchEnabled, false)
    assert.strictEqual(result.theme, 'light')
  })
})

// ==================== updateSettings ====================

describe('SettingsService.updateSettings', () => {
  it('должен создавать настройки если их нет', async () => {
    const prisma = createMockPrisma()
    const service = createService(prisma)

    const result = await service.updateSettings({
      originalsWatchEnabled: true,
      importWatchEnabled: false,
      theme: 'auto',
    })

    assert.strictEqual(result, true)
    const store = prisma._getStore()
    assert.strictEqual(store.setting.originalsWatchEnabled, true)
    assert.strictEqual(store.setting.theme, 'auto')
  })

  it('должен обновлять только переданные поля', async () => {
    const prisma = createMockPrisma()
    prisma._seed({
      id: 1,
      originalsPath: '/data/Originals',
      thumbnailsPath: '/data/Thumbnails',
      originalsWatchEnabled: false,
      importWatchEnabled: false,
      theme: 'light',
    })

    const service = createService(prisma)
    await service.updateSettings({ theme: 'dark' })

    const store = prisma._getStore()
    assert.strictEqual(store.setting.theme, 'dark')
    // Остальные поля должны сохраниться
    assert.strictEqual(store.setting.originalsWatchEnabled, false)
    assert.strictEqual(store.setting.originalsPath, '/data/Originals')
  })

  it('должен возвращать false при ошибке', async () => {
    const prisma = createMockPrisma()
    prisma.setting.upsert = async () => {
      throw new Error('DB error')
    }

    const service = createService(prisma)
    const result = await service.updateSettings({ theme: 'dark' })

    assert.strictEqual(result, false)
  })
})
