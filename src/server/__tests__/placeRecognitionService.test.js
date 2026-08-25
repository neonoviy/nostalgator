/**
 * Тесты для placeRecognitionService.js
 */
const { describe, it } = require('node:test')
const assert = require('node:assert')
const PlaceRecognitionService = require('../services/placeRecognitionService')

function createMockPrisma() {
  let placeIdCounter = 1
  let clusterIdCounter = 1
  const data = {
    media: [],
    place: [],
    eventLocation: [],
    cluster: [],
    clusterPlace: [],
    eventCluster: [],
    eventTag: [],
    tag: [],
  }

  const prisma = {
    _data: data,
    _seed: function (media = [], places = [], eventLocations = []) {
      data.media = media
      data.place = places
      data.eventLocation = eventLocations
      data.cluster = []
      data.clusterPlace = []
      data.eventCluster = []
      placeIdCounter = 1
      clusterIdCounter = 1
    },
    media: {
      findMany: async (query) => {
        let results = data.media.filter((m) => {
          if (query.where && query.where.eventId !== undefined && m.eventId !== query.where.eventId)
            return false
          if (
            query.where &&
            query.where.latitude &&
            query.where.latitude.not === null &&
            m.latitude === null
          )
            return false
          if (
            query.where &&
            query.where.longitude &&
            query.where.longitude.not === null &&
            m.longitude === null
          )
            return false
          return true
        })
        if (query.select) {
          results = results.map((m) => {
            const obj = {}
            for (const key of Object.keys(query.select)) {
              obj[key] = m[key]
            }
            return obj
          })
        }
        return results
      },
      updateMany: async () => ({ count: 0 }),
    },
    place: {
      findMany: async (query) => {
        let results = data.place
        if (query.where && query.where.polygon && query.where.polygon.not !== undefined) {
          results = results.filter((p) => p.polygon !== null && p.polygon !== undefined)
        }
        if (query.select) {
          results = results.map((p) => {
            const obj = {}
            for (const key of Object.keys(query.select)) {
              obj[key] = p[key]
            }
            return obj
          })
        }
        return results
      },
      findUnique: async (query) => {
        if (query.where && query.where.name) {
          return data.place.find((p) => p.name === query.where.name) || null
        }
        if (query.where && query.where.id) {
          return data.place.find((p) => p.id === query.where.id) || null
        }
        return null
      },
      create: async (query) => {
        const newPlace = {
          id: placeIdCounter++,
          ...query.data,
        }
        data.place.push(newPlace)
        return newPlace
      },
      update: async (query) => {
        const place = data.place.find((p) => p.id === query.where.id)
        if (!place) throw new Error('Place not found')
        Object.assign(place, query.data)
        return place
      },
    },
    cluster: {
      findMany: async (query) => {
        let results = data.cluster
        if (query.where && query.where.name && query.where.name.in) {
          results = results.filter((c) => query.where.name.in.includes(c.name))
        }
        if (query.select) {
          results = results.map((c) => {
            const obj = {}
            for (const key of Object.keys(query.select)) {
              obj[key] = c[key]
            }
            return obj
          })
        }
        return results
      },
      findFirst: async (query) => {
        if (query.where && query.where.latitude && query.where.longitude) {
          return (
            data.cluster.find(
              (c) =>
                c.latitude >= query.where.latitude.gte &&
                c.latitude < query.where.latitude.lt &&
                c.longitude >= query.where.longitude.gte &&
                c.longitude < query.where.longitude.lt,
            ) || null
          )
        }
        return null
      },
      create: async (query) => {
        const newCluster = {
          id: clusterIdCounter++,
          name: query.data.name,
          ...query.data,
        }
        data.cluster.push(newCluster)
        return newCluster
      },
      update: async (query) => {
        const cluster = data.cluster.find((c) => c.id === query.where.id)
        if (!cluster) throw new Error('Cluster not found')
        Object.assign(cluster, query.data)
        return cluster
      },
    },
    clusterPlace: {
      findFirst: async (query) => {
        return (
          data.clusterPlace.find(
            (cp) => cp.clusterId === query.where.clusterId && cp.placeId === query.where.placeId,
          ) || null
        )
      },
      upsert: async ({ where, create }) => {
        const existing = data.clusterPlace.find(
          (cp) =>
            cp.clusterId === where.clusterId_placeId.clusterId &&
            cp.placeId === where.clusterId_placeId.placeId,
        )
        if (existing) return existing
        const newRecord = { id: data.clusterPlace.length + 1, ...create }
        data.clusterPlace.push(newRecord)
        return newRecord
      },
    },
    eventCluster: {
      findMany: async (query) => {
        let results = data.eventCluster
        if (query.where && query.where.eventId !== undefined) {
          results = results.filter((ec) => ec.eventId === query.where.eventId)
        }
        if (query.include && query.include.cluster) {
          results = results.map((ec) => ({
            ...ec,
            cluster: data.cluster.find((c) => c.id === ec.clusterId) || null,
          }))
        }
        return results
      },
    },
    eventLocation: {
      findMany: async (query) => {
        let results = data.eventLocation
        if (query.where && query.where.eventId !== undefined) {
          results = results.filter((el) => el.eventId === query.where.eventId)
        }
        if (query.include && query.include.location) {
          results = results.map((el) => ({
            ...el,
            location: data.place.find((p) => p.id === el.locationId) || null,
          }))
        }
        return results
      },
      upsert: async ({ where, create }) => {
        const existing = data.eventLocation.find(
          (el) =>
            el.eventId === where.eventId_locationId.eventId &&
            el.locationId === where.eventId_locationId.locationId,
        )
        if (existing) return existing
        const newRecord = { ...create }
        data.eventLocation.push(newRecord)
        return newRecord
      },
    },
    tag: {
      findMany: async () => [],
      upsert: async () => ({}),
    },
    eventTag: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
    $transaction: async (fn) => {
      return fn({
        cluster: {
          findFirst: async (query) => prisma.cluster.findFirst(query),
          create: async (query) => prisma.cluster.create(query),
        },
        place: {
          findUnique: async (query) => prisma.place.findUnique(query),
          create: async (query) => prisma.place.create(query),
        },
      })
    },
  }

  return prisma
}

function createMockTagService() {
  const state = { places: [], clusters: [] }
  return {
    updateEventPlaces: async (_eventId, places) => {
      state.places = places
      return { places }
    },
    updateEventClusters: async (_eventId, clusters) => {
      state.clusters = clusters
      return { clusters }
    },
    updateEventCustomTags: async () => {},
    clearTagsCache: () => {},
  }
}

function createMockClusterPlaceService() {
  return {
    associateClustersWithPolygons: async () => ({ placeIds: [], clusterIds: [] }),
    addClusterPlace: async () => {},
    propagatePlaceToEvents: async () => {},
  }
}

// ==================== Очередь ====================

describe('PlaceRecognitionService queue', () => {
  it('queueGeneration добавляет в очередь', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    svc.queueGeneration({ id: 1, year: 2026, folderPath: '2026/01.07 Test' })

    assert.strictEqual(svc.queue.length, 1)
    assert.strictEqual(svc.queue[0].id, 1)
  })

  it('дубликаты не добавляются в очередь', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    svc.queueGeneration({ id: 1, year: 2026, folderPath: '2026/01.07 Test' })
    svc.queueGeneration({ id: 1, year: 2026, folderPath: '2026/01.07 Test' })

    assert.strictEqual(svc.queue.length, 1)
  })

  it('isQueueActive возвращает true когда есть элементы', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    assert.strictEqual(svc.isQueueActive(), false)

    svc.queueGeneration({ id: 1, year: 2026, folderPath: '2026/01.07 Test' })
    assert.strictEqual(svc.isQueueActive(), true)
  })
})

// ==================== Nominatim helpers ====================

describe('PlaceRecognitionService._pickCityName', () => {
  it('возвращает city', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    assert.strictEqual(svc._pickCityName({ city: 'Москва' }), 'Москва')
  })

  it('возвращает town если city нет', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    assert.strictEqual(svc._pickCityName({ town: 'Берлин' }), 'Берлин')
  })

  it('возвращает null для пустого адреса', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    assert.strictEqual(svc._pickCityName(null), null)
  })
})

describe('PlaceRecognitionService._closePolygon', () => {
  it('дополняет до замкнутого кольца', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    const coords = [
      [1, 2],
      [3, 4],
    ]
    const result = svc._closePolygon(coords)
    assert.deepStrictEqual(result[result.length - 1], [1, 2])
  })

  it('не дублирует точку если уже замкнуто', () => {
    const svc = new PlaceRecognitionService(
      createMockPrisma(),
      createMockTagService(),
      createMockClusterPlaceService(),
    )
    const coords = [
      [1, 2],
      [3, 4],
      [1, 2],
    ]
    const result = svc._closePolygon(coords)
    assert.strictEqual(result.length, 3)
  })
})

// ==================== processEvent ====================

describe('PlaceRecognitionService.processEvent', () => {
  it('событие без GPS → nothing', async () => {
    const prisma = createMockPrisma()
    prisma._seed([
      { eventId: 1, latitude: null, longitude: null },
      { eventId: 1, latitude: null, longitude: null },
    ])
    const tagService = createMockTagService()
    let placesCalled = false
    tagService.updateEventPlaces = async () => {
      placesCalled = true
    }

    const svc = new PlaceRecognitionService(prisma, tagService, createMockClusterPlaceService())
    await svc.processEvent(1, '2026/01.07 Test')

    assert.strictEqual(placesCalled, false)
  })

  it('Nominatim не найден → place не создаётся, scanning продолжается', async () => {
    const prisma = createMockPrisma()
    prisma._seed([{ eventId: 1, latitude: 55.75581, longitude: 37.61731 }])

    const tagService = createMockTagService()
    const clusterPlaceService = createMockClusterPlaceService()
    const svc = new PlaceRecognitionService(prisma, tagService, clusterPlaceService)

    svc._requestPolygonFromNominatim = async () => null

    await svc.processEvent(1, '2026/01.07 Test')

    assert.strictEqual(prisma._data.place.length, 0)
  })
})

// ==================== _getOrCreatePlaceByName ====================

describe('PlaceRecognitionService._getOrCreatePlaceByName', () => {
  it('создаёт Place по имени', async () => {
    const prisma = createMockPrisma()
    const tagService = createMockTagService()
    const svc = new PlaceRecognitionService(prisma, tagService, createMockClusterPlaceService())

    svc._requestPolygonFromNominatim = async () => null

    const place = await svc._getOrCreatePlaceByName('Москва')

    assert.ok(place.id > 0)
    assert.strictEqual(place.name, 'Москва')
  })

  it('повторный вызов с тем же именем → возвращает существующий', async () => {
    const prisma = createMockPrisma()
    const tagService = createMockTagService()
    const svc = new PlaceRecognitionService(prisma, tagService, createMockClusterPlaceService())

    svc._requestPolygonFromNominatim = async () => null

    const p1 = await svc._getOrCreatePlaceByName('Москва')
    const p2 = await svc._getOrCreatePlaceByName('Москва')

    assert.strictEqual(p1.id, p2.id)
    assert.strictEqual(prisma._data.place.length, 1)
  })
})
