const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs').promises
const os = require('os')
const EventService = require('../eventService')

// ==================== Моки ====================

/**
 * Создаём мок Prisma-клиента.
 * По умолчанию все методы возвращают «пустые» значения.
 * Тест перезаписывает конкретные методы под свой сценарий.
 */
function createMockPrisma() {
  // Хранилище данных для симуляции реальных запросов
  const _store = { events: [] }

  return {
    event: {
      findUnique: async ({ where }) => {
        if (where.id) return _store.events.find((e) => e.id === where.id) || null
        if (where.folderPath)
          return _store.events.find((e) => e.folderPath === where.folderPath) || null
        return null
      },
      findMany: async ({ where, orderBy, select, skip, take, include }) => {
        let results = [..._store.events]

        // Если include — добавляем пустые связи
        if (include) {
          results = results.map((e) => ({ ...e }))
          if (include.eventTags) {
            results = results.map((e) => ({
              ...e,
              eventTags: [],
            }))
          }
        }

        // Фильтрация
        if (where && where.year && where.year.in) {
          results = results.filter((e) => where.year.in.includes(e.year))
        }
        if (where && where.searchableTitle && where.searchableTitle.contains) {
          const search = where.searchableTitle.contains.toLowerCase()
          results = results.filter((e) => (e.searchableTitle || '').includes(search))
        }

        // Сортировка
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          results.sort((a, b) => {
            const va = a[field],
              vb = b[field]
            if (va === null || va === undefined) return 1
            if (vb === null || vb === undefined) return -1
            return dir === 'desc' ? vb - va : va - vb
          })
        }

        // select
        if (select) {
          results = results.map((e) => {
            const obj = {}
            for (const key of Object.keys(select)) obj[key] = e[key]
            return obj
          })
        }

        // skip/take
        if (skip) results = results.slice(skip)
        if (take) results = results.slice(0, take)

        return results
      },
      count: async ({ where } = {}) => {
        if (!where) return _store.events.length
        if (where.year && where.year.in) {
          return _store.events.filter((e) => where.year.in.includes(e.year)).length
        }
        return _store.events.length
      },
      create: async (data) => data.data,
      update: async (data) => data.data,
      delete: async () => ({}),
    },
    eventTag: {
      findMany: async () => [],
    },
    userGroup: {
      findMany: async () => [],
    },
    // $queryRawUnsafe — мок для getEvents (FTS5 MATCH + курсорная пагинация)
    $queryRawUnsafe: async (sql, ...params) => {
      // SELECT запрос — возвращаем события
      let results = [..._store.events]

      // FTS5 MATCH — фильтрация по search
      const matchIndex = sql.indexOf('EventFTS MATCH')
      if (matchIndex !== -1 && params.length > 0) {
        const matchParam = params.find((p) => typeof p === 'string' && p.endsWith('*'))
        if (matchParam) {
          const prefix = matchParam.slice(0, -1).toLowerCase()
          results = results.filter((e) =>
            (e.searchableTitle || '').toLowerCase().startsWith(prefix),
          )
        }
      }

      // Курсорная пагинация — параметры: safeDate, safeDate, cursorId
      // Ищем числовой параметр в конце (cursorId) — это курсор
      const cursorParamIdx = params.findIndex(
        (p, i) =>
          Number.isInteger(p) &&
          p > 0 &&
          i > 0 &&
          typeof params[i - 1] === 'string' &&
          params[i - 1].startsWith('0000'),
      )
      if (cursorParamIdx !== -1) {
        const cursorId = params[cursorParamIdx]
        results = results.filter((e) => e.id < cursorId)
      }

      // Обработка WHERE (упрощённо — только year IN)
      for (const param of params) {
        if (Array.isArray(param)) {
          results = results.filter((e) => param.includes(e.year))
        }
      }

      // Сортировка: COALESCE(date) DESC, id DESC
      if (sql.includes('COALESCE') || sql.includes('ORDER BY')) {
        results.sort((a, b) => {
          const da = a.date ? new Date(a.date) : new Date('0000-01-01')
          const db2 = b.date ? new Date(b.date) : new Date('0000-01-01')
          if (db2.getTime() !== da.getTime()) return db2 - da
          return b.id - a.id
        })
      }

      const limitMatch = sql.match(/LIMIT\s+(\d+)/)
      if (limitMatch) results = results.slice(0, parseInt(limitMatch[1]))

      return results
    },
    eventParticipant: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    // Вспомогательный метод для заполнения хранилища
    _seed: (events) => {
      _store.events = events
    },
  }
}

/** Создаём EventService с моками */
function createServiceWithMocks(overrides = {}) {
  const service = new EventService('/fake/Originals', '/fake/Thumbnails')
  service.prisma = createMockPrisma()
  service.tagService = {
    updateEventTags: async () => ({ event: null, tags: {}, cleanup: {} }),
    updateEventTagsWithCleanup: async () => ({ event: null, tags: {}, cleanup: {} }),
    clearTagsCache: () => {},
  }
  service.watcherService = null
  service.scanService = null
  service.thumbnailService = null
  service.isInitialized = true

  // Переопределяем если нужно
  if (overrides.prisma) service.prisma = overrides.prisma
  if (overrides.tagService) service.tagService = overrides.tagService

  return service
}

// ==================== Тесты: getEventById ====================

describe('EventService.getEventById', () => {
  it('должен возвращать событие с трансформированными тегами', async () => {
    const prisma = createMockPrisma()
    prisma.event.findUnique = async () => ({
      id: 1,
      title: 'Отпуск',
      folderPath: '2026/07.01 Отпуск',
      year: 2026,
      date: new Date('2026-07-01'),
      eventLocations: [{ location: { name: 'Сочи' } }],
      eventEventTypes: [{ eventType: { type: 'отдых' } }],
      eventParticipants: [],
      eventTags: [{ tag: { name: 'море' } }],
    })

    const service = createServiceWithMocks({ prisma })
    const result = await service.getEventById(1)

    assert.strictEqual(result.id, 1)
    assert.deepStrictEqual(result.places, ['Сочи'])
    assert.deepStrictEqual(result.eventType, ['отдых'])
    assert.deepStrictEqual(result.tags, ['море'])
  })

  it('должен возвращать null если событие не найдено', async () => {
    const prisma = createMockPrisma()
    prisma.event.findUnique = async () => null

    const service = createServiceWithMocks({ prisma })
    const result = await service.getEventById(999)

    assert.strictEqual(result, null)
  })
})

// ==================== Тесты: getYears ====================

describe('EventService.getYears', () => {
  it('должен возвращать отсортированный список годов', async () => {
    const prisma = createMockPrisma()
    prisma._seed([{ year: 2024 }, { year: 2026 }, { year: 2025 }])
    prisma.$queryRawUnsafe = async () => [{ year: 2026 }, { year: 2025 }, { year: 2024 }]

    const service = createServiceWithMocks({ prisma })
    const result = await service.getYears()

    assert.deepStrictEqual(result, [2026, 2025, 2024])
  })

  it('должен возвращать пустой массив если нет событий', async () => {
    const prisma = createMockPrisma()
    prisma.$queryRawUnsafe = async () => []

    const service = createServiceWithMocks({ prisma })
    const result = await service.getYears()

    assert.deepStrictEqual(result, [])
  })
})

// ==================== Тесты: hasEvents ====================

describe('EventService.hasEvents', () => {
  it('должен возвращать true если есть события', async () => {
    const prisma = createMockPrisma()
    prisma.event.count = async () => 5

    const service = createServiceWithMocks({ prisma })
    const result = await service.hasEvents()

    assert.strictEqual(result, true)
  })

  it('должен возвращать false если нет событий', async () => {
    const prisma = createMockPrisma()
    prisma.event.count = async () => 0

    const service = createServiceWithMocks({ prisma })
    const result = await service.hasEvents()

    assert.strictEqual(result, false)
  })
})

// ==================== Тесты: deleteEvent ====================

describe('EventService.deleteEvent', () => {
  it('должен удалять связи участников перед удалением события', async () => {
    const prisma = createMockPrisma()
    let deleteManyCalled = false
    let deleteCalled = false

    prisma.eventParticipant.deleteMany = async ({ where }) => {
      deleteManyCalled = true
      assert.strictEqual(where.eventId, 42)
      return { count: 2 }
    }
    prisma.event.delete = async ({ where }) => {
      deleteCalled = true
      assert.strictEqual(where.id, 42)
      return {}
    }

    const service = createServiceWithMocks({ prisma })
    await service.deleteEvent(42)

    assert.strictEqual(deleteManyCalled, true, 'deleteMany участников должен быть вызван')
    assert.strictEqual(deleteCalled, true, 'delete события должен быть вызван')
  })
})

// ==================== Тесты: deleteEventWithThumbnails ====================

describe('EventService.deleteEventWithThumbnails', () => {
  it('должен удалять миниатюры, оригиналы (при deleteOriginals=true) и событие из БД', async () => {
    const prisma = createMockPrisma()
    let eventDeleteCalled = false

    prisma.event.findUnique = async () => ({ id: 1, folderPath: '2026/01.04 Test' })
    prisma.event.delete = async () => {
      eventDeleteCalled = true
      return {}
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-test-'))
    const thumbnailsDir = path.join(tmpDir, 'Thumbnails', '2026', '1')
    const originalsDir = path.join(tmpDir, 'Originals', '2026', '01.04 Test')
    await fs.mkdir(thumbnailsDir, { recursive: true })
    await fs.mkdir(originalsDir, { recursive: true })

    const service = new EventService(
      path.join(tmpDir, 'Originals'),
      path.join(tmpDir, 'Thumbnails'),
    )
    service.prisma = prisma
    service.tagService = {
      updateEventTags: async () => ({ event: null, tags: {}, cleanup: {} }),
      updateEventTagsWithCleanup: async () => ({ event: null, tags: {}, cleanup: {} }),
      clearTagsCache: () => {},
    }
    service.watcherService = null
    service.scanService = null
    service.thumbnailService = null
    service.isInitialized = true

    await service.deleteEventWithThumbnails(1, thumbnailsDir, true)

    assert.strictEqual(eventDeleteCalled, true)

    const thumbExists = await fs
      .access(thumbnailsDir)
      .then(() => true)
      .catch(() => false)
    const origExists = await fs
      .access(originalsDir)
      .then(() => true)
      .catch(() => false)
    assert.strictEqual(thumbExists, false, 'Thumbnails should be deleted')
    assert.strictEqual(origExists, false, 'Originals should be deleted')

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('должен НЕ удалять оригиналы при deleteOriginals=false', async () => {
    const prisma = createMockPrisma()
    let eventDeleteCalled = false

    prisma.event.findUnique = async () => ({ id: 1, folderPath: '2026/01.04 Test' })
    prisma.event.delete = async () => {
      eventDeleteCalled = true
      return {}
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-test-'))
    const thumbnailsDir = path.join(tmpDir, 'Thumbnails', '2026', '1')
    const originalsDir = path.join(tmpDir, 'Originals', '2026', '01.04 Test')
    await fs.mkdir(thumbnailsDir, { recursive: true })
    await fs.mkdir(originalsDir, { recursive: true })

    const service = new EventService(
      path.join(tmpDir, 'Originals'),
      path.join(tmpDir, 'Thumbnails'),
    )
    service.prisma = prisma
    service.tagService = {
      updateEventTags: async () => ({ event: null, tags: {}, cleanup: {} }),
      updateEventTagsWithCleanup: async () => ({ event: null, tags: {}, cleanup: {} }),
      clearTagsCache: () => {},
    }
    service.watcherService = null
    service.scanService = null
    service.thumbnailService = null
    service.isInitialized = true

    await service.deleteEventWithThumbnails(1, thumbnailsDir, false)

    assert.strictEqual(eventDeleteCalled, true)

    const thumbExists = await fs
      .access(thumbnailsDir)
      .then(() => true)
      .catch(() => false)
    const origExists = await fs
      .access(originalsDir)
      .then(() => true)
      .catch(() => false)
    assert.strictEqual(thumbExists, false, 'Thumbnails should be deleted')
    assert.strictEqual(origExists, true, 'Originals should NOT be deleted')

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('должен блокировать удаление оригиналов когда ORIGINALS_READONLY=true', async () => {
    const prisma = createMockPrisma()
    let eventDeleteCalled = false

    prisma.event.findUnique = async () => ({ id: 1, folderPath: '2026/01.04 Test' })
    prisma.event.delete = async () => {
      eventDeleteCalled = true
      return {}
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-test-'))
    const thumbnailsDir = path.join(tmpDir, 'Thumbnails', '2026', '1')
    const originalsDir = path.join(tmpDir, 'Originals', '2026', '01.04 Test')
    await fs.mkdir(thumbnailsDir, { recursive: true })
    await fs.mkdir(originalsDir, { recursive: true })

    const service = new EventService(
      path.join(tmpDir, 'Originals'),
      path.join(tmpDir, 'Thumbnails'),
    )
    service.prisma = prisma
    service.tagService = {
      updateEventTags: async () => ({ event: null, tags: {}, cleanup: {} }),
      updateEventTagsWithCleanup: async () => ({ event: null, tags: {}, cleanup: {} }),
      clearTagsCache: () => {},
    }
    service.watcherService = null
    service.scanService = null
    service.thumbnailService = null
    service.isInitialized = true

    const originalFlag = process.env.ORIGINALS_READONLY
    process.env.ORIGINALS_READONLY = 'true'

    await service.deleteEventWithThumbnails(1, thumbnailsDir, true)

    process.env.ORIGINALS_READONLY = originalFlag

    assert.strictEqual(eventDeleteCalled, true)

    const thumbExists = await fs
      .access(thumbnailsDir)
      .then(() => true)
      .catch(() => false)
    const origExists = await fs
      .access(originalsDir)
      .then(() => true)
      .catch(() => false)
    assert.strictEqual(thumbExists, false, 'Thumbnails should be deleted')
    assert.strictEqual(origExists, true, 'Originals should NOT be deleted in readonly mode')

    await fs.rm(tmpDir, { recursive: true, force: true })
  })
})

// ==================== getYearCounts ====================

describe('EventService.getYearCounts', () => {
  it('должен возвращать GROUP BY с сырыми SQL', async () => {
    const prisma = createMockPrisma()

    let rawSqlCalled = false
    let capturedSql = ''
    let capturedParams = []

    prisma.$queryRawUnsafe = async (sql, ...params) => {
      rawSqlCalled = true
      capturedSql = sql
      capturedParams = params
      return [
        { year: 2025, cnt: 3n },
        { year: 2024, cnt: 1n },
      ]
    }
    prisma.event.count = async () => 4

    const service = createServiceWithMocks({ prisma })
    const result = await service.getYearCounts({}, null)

    assert.strictEqual(rawSqlCalled, true, '$queryRawUnsafe должен быть вызван')
    assert.ok(capturedSql.includes('GROUP BY'), 'SQL должен содержать GROUP BY')
    assert.ok(capturedSql.includes('COUNT'), 'SQL должен содержать COUNT')
    assert.deepStrictEqual(result, [
      { year: 2025, count: 3 },
      { year: 2024, count: 1 },
    ])
  })

  it('должен применять фильтры в SQL', async () => {
    const prisma = createMockPrisma()

    let capturedSql = ''
    prisma.$queryRawUnsafe = async (sql, ...params) => {
      capturedSql = sql
      return []
    }
    prisma.event.count = async () => 0

    const service = createServiceWithMocks({ prisma })
    await service.getYearCounts({ places: ['Москва'] }, null)

    assert.ok(capturedSql.includes('EventLocation'), 'SQL должен включать фильтр places')
  })
})

// ==================== FTS5 поиск ====================

describe('EventService._buildFilterWhere (FTS5)', () => {
  it('должен использовать MATCH вместо LIKE для поиска', async () => {
    const prisma = createMockPrisma()

    let capturedSql = ''
    let capturedParams = []
    prisma.$queryRawUnsafe = async (sql, ...params) => {
      capturedSql = sql
      capturedParams = params
      return []
    }

    const service = createServiceWithMocks({ prisma })
    await service.getEvents(null, undefined, { search: 'прогул' }, null)

    assert.ok(capturedSql.includes('EventFTS MATCH'), 'SQL должен содержать FTS5 MATCH')
    assert.ok(
      capturedParams[0].endsWith('*'),
      'Параметр должен заканчиваться на * (префиксный поиск)',
    )
    assert.ok(capturedParams[0].includes('прогул'), 'Параметр должен содержать поисковый запрос')
  })

  it('должен экранировать спецсимволы FTS5', async () => {
    const service = createServiceWithMocks()
    const escaped = service._escapeFTS5('test-query"foo')

    assert.ok(escaped.includes('"'), 'Спецсимволы должны быть экранированы')
  })

  it('должен возвращать пустой массив если поиск не дал результатов', async () => {
    const prisma = createMockPrisma()
    prisma.$queryRawUnsafe = async () => []

    const service = createServiceWithMocks({ prisma })
    const result = await service.getEvents(null, undefined, { search: 'несуществующий' }, null)

    assert.deepStrictEqual(result, { events: [], nextCursor: null })
  })
})
