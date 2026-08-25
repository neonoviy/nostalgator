const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const TagService = require('../tagService')

// ==================== Моки ====================

function createMockPrisma() {
  const _store = {
    places: [],
    eventTypes: [],
    participants: [],
    tags: [],
    clusters: [],
    eventLocations: [],
    eventEventTypes: [],
    eventParticipants: [],
    eventTags: [],
    eventClusters: [],
  }

  let nextId = 1
  const genId = () => nextId++

  function mockModel(storeName, nameField = 'name') {
    return {
      findMany: async ({ orderBy, include }) => {
        let results = [..._store[storeName]]
        // Сортировка
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          results.sort((a, b) => {
            const va = (a[field] || '').toLowerCase()
            const vb = (b[field] || '').toLowerCase()
            return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
          })
        }
        return results
      },
      findUnique: async ({ where }) => {
        const key = Object.keys(where)[0]
        return (
          _store[storeName].find((item) => {
            if (key === 'id') return item.id === where.id
            return item[key] === where[key]
          }) || null
        )
      },
      upsert: async ({ where, create }) => {
        const key = Object.keys(where)[0]
        let existing = _store[storeName].find((item) => item[key] === where[key])
        if (existing) return existing
        const newItem = { id: genId(), ...create }
        _store[storeName].push(newItem)
        return newItem
      },
      update: async ({ where, data }) => {
        const item = _store[storeName].find((i) => i.id === where.id)
        if (!item) return null
        Object.assign(item, data)
        return item
      },
      delete: async ({ where }) => {
        const idx = _store[storeName].findIndex((i) => i.id === where.id)
        if (idx === -1) return null
        const [removed] = _store[storeName].splice(idx, 1)
        return removed
      },
      deleteMany: async ({ where }) => {
        const before = _store[storeName].length
        // Простая логика: если where.eventId — удаляем все с этим eventId
        if (where.eventId !== undefined) {
          _store[storeName] = _store[storeName].filter((i) => i.eventId !== where.eventId)
        } else {
          // Для остальных — удаляем всё (упрощённо)
          _store[storeName] = []
        }
        return { count: before - _store[storeName].length }
      },
      create: async ({ data }) => {
        const newItem = { id: genId(), ...data }
        _store[storeName].push(newItem)
        return newItem
      },
      count: async ({ where }) => {
        if (Object.keys(where).length === 0) return _store[storeName].length
        return _store[storeName].filter((item) => {
          for (const [key, val] of Object.entries(where)) {
            if (val?.in) return val.in.includes(item[key])
            if (item[key] !== val) return false
          }
          return true
        }).length
      },
    }
  }

  const prisma = {
    place: mockModel('places', 'name'),
    eventType: mockModel('eventTypes', 'type'),
    participant: mockModel('participants', 'name'),
    tag: mockModel('tags', 'name'),
    cluster: mockModel('clusters'),
    eventLocation: mockModel('eventLocations'),
    eventCluster: mockModel('eventClusters'),
    eventEventType: mockModel('eventEventTypes'),
    eventParticipant: mockModel('eventParticipants'),
    eventTag: mockModel('eventTags'),
    event: {
      findUnique: async () => null,
      count: async () => 0,
    },
    $transaction: async (fn) => fn(prisma),
    // Для тестов
    _getStore: () => _store,
    _nextId: () => nextId,
    _setNextId: (n) => {
      nextId = n
    },
  }

  // Особые модели
  prisma.place = mockModel('places', 'name')
  prisma.eventType = mockModel('eventTypes', 'type')
  prisma.participant = mockModel('participants', 'name')
  prisma.tag = mockModel('tags', 'name')
  prisma.cluster = mockModel('clusters')

  return prisma
}

function createService(prisma) {
  const svc = new TagService({ prisma })
  // Уменьшаем TTL для тестов кэша
  svc.CACHE_TTL = 50 // 50ms
  return svc
}

// ==================== getAll ====================

describe('TagService.getPlaces', () => {
  it('должен возвращать отсортированный список', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.places = [
      { id: 2, name: 'Сочи' },
      { id: 1, name: 'Москва' },
    ]

    const svc = createService(prisma)
    const result = await svc.getPlaces()

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].name, 'Москва')
    assert.strictEqual(result[1].name, 'Сочи')
  })

  it('должен возвращать пустой массив при ошибке', async () => {
    const prisma = createMockPrisma()
    prisma.place.findMany = async () => {
      throw new Error('DB error')
    }

    const svc = createService(prisma)
    const result = await svc.getPlaces()

    assert.deepStrictEqual(result, [])
  })
})

// ==================== updateEventTags ====================

describe('TagService.updateEventTags', () => {
  it('должен обновлять все 4 типа тегов', async () => {
    const prisma = createMockPrisma()
    prisma.event.findUnique = async () => ({ id: 1, title: 'Test' })

    const svc = createService(prisma)
    const result = await svc.updateEventTags(1, {
      places: ['Москва'],
      eventTypes: ['свадьба'],
      participants: ['Иван'],
      tags: ['лето'],
    })

    const store = prisma._getStore()
    assert.strictEqual(store.places.length, 1)
    assert.strictEqual(store.eventTypes.length, 1)
    assert.strictEqual(store.participants.length, 1)
    assert.strictEqual(store.tags.length, 1)
  })

  it('должен очищать кэш после обновления', async () => {
    const prisma = createMockPrisma()
    prisma.event.findUnique = async () => ({})

    const svc = createService(prisma)
    await svc.updateEventTags(1, { places: ['Москва'] })

    assert.ok(!svc._isCacheValid(), 'Кэш должен быть очищен')
  })

  it('должен обновлять только переданные типы тегов', async () => {
    const prisma = createMockPrisma()
    prisma.event.findUnique = async () => ({})

    const svc = createService(prisma)
    await svc.updateEventTags(1, { tags: ['лето'] })

    const store = prisma._getStore()
    assert.strictEqual(store.tags.length, 1)
    assert.strictEqual(store.places.length, 0)
    assert.strictEqual(store.eventTypes.length, 0)
  })
})

// ==================== updateEventPlaces ====================

describe('TagService.updateEventPlaces', () => {
  it('должен создавать теги и связи', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    await svc.updateEventPlaces(1, ['Москва', 'Сочи'])

    const store = prisma._getStore()
    assert.strictEqual(store.places.length, 2)
    assert.strictEqual(store.eventLocations.length, 2)
  })

  it('должен удалять старые связи перед созданием новых', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    // Сначала добавим связи
    await svc.updateEventPlaces(1, ['Москва'])
    assert.strictEqual(prisma._getStore().eventLocations.length, 1)

    // Потом обновим — старые должны удалиться, новые создаться
    await svc.updateEventPlaces(1, ['Сочи'])

    const store = prisma._getStore()
    assert.strictEqual(store.eventLocations.length, 1, 'Должна остаться 1 связь')
    assert.strictEqual(store.places.length, 2, 'Должно быть 2 места (Москва + Сочи)')
  })

  it('должен принимать строку с запятыми', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    await svc.updateEventPlaces(1, 'Москва, Сочи')

    const store = prisma._getStore()
    assert.strictEqual(store.places.length, 2)
  })
})

// ==================== getTagCounts (denorm) ====================

describe('TagService.getTagCounts (denorm)', () => {
  it('должен использовать denorm для типа places', async () => {
    const prisma = createMockPrisma()

    let capturedSql = ''
    prisma.$queryRawUnsafe = async (sql, ...params) => {
      capturedSql = sql
      return [{ id: 1, name: 'Москва', count: 2 }]
    }

    const svc = createService(prisma)
    const result = await svc.getTagCounts({}, 'places', null)

    assert.ok(
      capturedSql.includes('AllowedGroupIds') || capturedSql.includes('allowedGroupIds'),
      'SQL должен проверять allowedGroupIds (denorm)',
    )
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].id, 1)
    assert.strictEqual(result[0].name, 'Москва')
    assert.strictEqual(result[0].count, 2)
  })

  it('должен использовать denorm для типа eventTypes', async () => {
    const prisma = createMockPrisma()

    let capturedSql = ''
    prisma.$queryRawUnsafe = async (sql, ...params) => {
      capturedSql = sql
      return [{ id: 2, name: 'свадьба', count: 1 }]
    }

    const svc = createService(prisma)
    await svc.getTagCounts({}, 'eventTypes', null)

    assert.ok(
      capturedSql.includes('AllowedGroupIds') || capturedSql.includes('allowedGroupIds'),
      'SQL должен проверять allowedGroupIds (denorm)',
    )
  })

  it('должен возвращать 0 для тегов без событий', async () => {
    const prisma = createMockPrisma()

    prisma.$queryRawUnsafe = async (sql, ...params) => {
      return [{ id: 5, name: '_unused', count: 0 }]
    }

    const svc = createService(prisma)
    const result = await svc.getTagCounts({}, 'tags', null)

    assert.strictEqual(result[0].count, 0)
  })
})

// ==================== renameTag ====================

describe('TagService.renameTag', () => {
  it('должен переименовывать тег', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.places.push({ id: 1, name: 'Старое' })

    const svc = createService(prisma)
    const result = await svc.renameTag('places', 1, 'Новое')

    assert.strictEqual(result.success, true)
    assert.strictEqual(store.places[0].name, 'Новое')
  })

  it('должен отклонять дублирующее имя', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.places.push({ id: 1, name: 'Москва' })
    store.places.push({ id: 2, name: 'Сочи' })

    const svc = createService(prisma)

    await assert.rejects(
      async () => await svc.renameTag('places', 2, 'Москва'),
      (err) => {
        assert.ok(err.message.includes('уже существует'))
        return true
      },
    )
  })

  it('должен отклонять неизвестный тип', async () => {
    const svc = createService(createMockPrisma())

    await assert.rejects(
      async () => await svc.renameTag('invalid', 1, 'test'),
      (err) => {
        assert.ok(err.message.includes('Неизвестный тип'))
        return true
      },
    )
  })

  it('должен очищать кэш после переименования', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.places.push({ id: 1, name: 'Старое' })

    const svc = createService(prisma)
    // Сначала заполним кэш
    await svc.getPlaces()
    assert.ok(svc._isCacheValid(), 'Кэш должен быть валиден')

    await svc.renameTag('places', 1, 'Новое')
    assert.ok(!svc._isCacheValid(), 'Кэш должен быть очищен')
  })
})

// ==================== deleteTag ====================

describe('TagService.deleteTag', () => {
  it('должен удалять тег и его связи', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.places.push({ id: 1, name: 'Москва' })
    store.eventLocations.push({ id: 1, eventId: 1, locationId: 1 })

    const svc = createService(prisma)
    const result = await svc.deleteTag('places', 1)

    assert.strictEqual(result.eventsAffected, 1)
    assert.strictEqual(store.places.length, 0)
  })

  it('должен отклонять неизвестный тип', async () => {
    const svc = createService(createMockPrisma())

    await assert.rejects(
      async () => await svc.deleteTag('invalid', 1),
      (err) => {
        assert.ok(err.message.includes('Неизвестный тип'))
        return true
      },
    )
  })
})

// ==================== getTagCounts ====================

describe('TagService.getTagCounts', () => {
  it('должен возвращать пустой массив для неизвестного типа', async () => {
    const svc = createService(createMockPrisma())
    const result = await svc.getTagCounts({}, 'invalid')
    assert.deepStrictEqual(result, [])
  })
})

// ==================== getAllTagCounts ====================

describe('TagService.getAllTagCounts', () => {
  it('должен возвращать счётчики для всех типов', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    store.places.push({ id: 1, name: 'Москва' })
    store.eventTypes.push({ id: 1, type: 'свадьба' })
    store.participants.push({ id: 1, name: 'Иван' })
    store.tags.push({ id: 1, name: 'лето' })

    // Мокаем $queryRawUnsafe для всех 4 типов
    prisma.$queryRawUnsafe = async (sql, ...params) => {
      if (sql.includes('Place')) return [{ id: 1, name: 'Москва', count: 0 }]
      if (sql.includes('EventType')) return [{ id: 1, type: 'свадьба', count: 0 }]
      if (sql.includes('Participant')) return [{ id: 1, name: 'Иван', count: 0 }]
      if (sql.includes('Tag')) return [{ id: 1, name: 'лето', count: 0 }]
      return []
    }

    const svc = createService(prisma)
    const result = await svc.getAllTagCounts({})

    assert.ok(result.places)
    assert.ok(result.eventTypes)
    assert.ok(result.participants)
    assert.ok(result.tags)
  })
})

// ==================== cleanupUnusedTags ====================

describe('TagService.cleanupUnusedTags', () => {
  it('должен возвращать статистику удалений', async () => {
    const prisma = createMockPrisma()
    const store = prisma._getStore()
    // Создадим «неиспользуемые» теги (без связей)
    store.places.push({ id: 1, name: 'Москва' })
    store.eventTypes.push({ id: 1, type: 'свадьба' })

    // deleteMany вернёт количество
    prisma.place.deleteMany = async () => ({ count: 1 })
    prisma.cluster.deleteMany = async () => ({ count: 0 })
    prisma.eventType.deleteMany = async () => ({ count: 1 })
    prisma.participant.deleteMany = async () => ({ count: 0 })
    prisma.tag.deleteMany = async () => ({ count: 0 })
    prisma.eventCluster.deleteMany = async () => ({ count: 0 })

    const svc = createService(prisma)
    const result = await svc.cleanupUnusedTags()

    assert.strictEqual(result.places, 1)
    assert.strictEqual(result.eventTypes, 1)
    assert.strictEqual(result.participants, 0)
    assert.strictEqual(result.tags, 0)
  })
})

// ==================== Кэш ====================

describe('TagService кэш', () => {
  it('должен кэшировать результаты getPlaces', async () => {
    const prisma = createMockPrisma()
    prisma._getStore().places = [{ id: 1, name: 'Москва' }]

    const svc = createService(prisma)

    // Первый вызов — читает из БД
    await svc.getPlaces()
    assert.ok(svc._isCacheValid())

    // Второй вызов — должен из кэша (findMany не вызывается повторно)
    // Проверяем что кэш валиден
    assert.strictEqual(svc.tagsCache.places.length, 1)
    assert.strictEqual(svc.tagsCache.places[0].name, 'Москва')
  })

  it('должен инвалидировать кэш по истечении TTL', async () => {
    const prisma = createMockPrisma()
    prisma._getStore().places = [{ id: 1, name: 'Москва' }]

    const svc = createService(prisma)
    await svc.getPlaces()
    assert.ok(svc._isCacheValid())

    // Ждём истечения TTL
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(!svc._isCacheValid(), 'Кэш должен истечь')
  })

  it('clearTagsCache должен полностью очищать кэш', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    svc.tagsCache.places = ['cached']
    svc.tagsCache.timestamp = Date.now()

    svc.clearTagsCache()

    assert.strictEqual(svc.tagsCache.places, null)
    assert.strictEqual(svc.tagsCache.timestamp, 0)
    assert.ok(!svc._isCacheValid())
  })
})

// ==================== updateEventTagsWithCleanup ====================

describe('TagService.updateEventTagsWithCleanup', () => {
  it('должен обновлять теги и запускать cleanup', async () => {
    const prisma = createMockPrisma()
    prisma.event.findUnique = async () => ({ id: 1, title: 'Test' })
    prisma.place.deleteMany = async () => ({ count: 0 })
    prisma.eventType.deleteMany = async () => ({ count: 0 })
    prisma.participant.deleteMany = async () => ({ count: 0 })
    prisma.tag.deleteMany = async () => ({ count: 0 })

    const svc = createService(prisma)
    const result = await svc.updateEventTagsWithCleanup(1, {
      places: ['Москва'],
    })

    assert.ok(result.event)
    assert.ok(result.tags)
    assert.ok(result.cleanup)
  })
})
