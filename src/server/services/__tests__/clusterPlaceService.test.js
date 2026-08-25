/**
 * Тесты для clusterPlaceService.js
 */
const { describe, it } = require('node:test')
const assert = require('node:assert')
const ClusterPlaceService = require('../clusterPlaceService')

// ==================== Хелперы ====================

function createMockPrisma() {
  const data = {
    places: [],
    clusters: [],
    clusterPlaces: [],
    eventClusters: [],
    eventLocations: [],
  }

  const prisma = {
    place: {
      findMany: async (query) => {
        let results = [...data.places]
        if (query.where && query.where.polygon !== null) {
          results = results.filter((p) => p.polygon !== null)
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
        return data.places.find((p) => p.id === query.where.id) || null
      },
    },
    cluster: {
      findMany: async (query) => {
        let results = [...data.clusters]
        if (query.where) {
          if (query.where.latitude && query.where.latitude.not === null) {
            results = results.filter((c) => c.latitude !== null)
          }
          if (query.where.longitude && query.where.longitude.not === null) {
            results = results.filter((c) => c.longitude !== null)
          }
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
    },
    clusterPlace: {
      findFirst: async (query) => {
        return (
          data.clusterPlaces.find(
            (cp) => cp.clusterId === query.where.clusterId && cp.placeId === query.where.placeId,
          ) || null
        )
      },
      upsert: async ({ where, create }) => {
        const existing = data.clusterPlaces.find(
          (cp) =>
            cp.clusterId === where.clusterId_placeId.clusterId &&
            cp.placeId === where.clusterId_placeId.placeId,
        )
        if (existing) return existing
        const newRecord = { id: data.clusterPlaces.length + 1, ...create }
        data.clusterPlaces.push(newRecord)
        return newRecord
      },
      createMany: async ({ data: rows }) => {
        for (const row of rows) {
          data.clusterPlaces.push({ id: data.clusterPlaces.length + 1, ...row })
        }
      },
      deleteMany: async ({ where }) => {
        const before = data.clusterPlaces.length
        data.clusterPlaces = data.clusterPlaces.filter((cp) => cp.placeId !== where.placeId)
        return { count: before - data.clusterPlaces.length }
      },
    },
    eventCluster: {
      findMany: async (query) => {
        let results = [...data.eventClusters]
        if (query.where && query.where.clusterId && query.where.clusterId.in) {
          results = results.filter((ec) => query.where.clusterId.in.includes(ec.clusterId))
        }
        if (query.select) {
          results = results.map((ec) => {
            const obj = {}
            for (const key of Object.keys(query.select)) {
              if (key === 'eventId') obj[key] = ec.eventId
              else if (key === 'event') {
                obj.event = { allowedGroupIds: ec.allowedGroupIds || null }
              }
            }
            return obj
          })
        }
        return results
      },
    },
    eventLocation: {
      findMany: async (query) => {
        let results = [...data.eventLocations]
        if (query.where && query.where.locationId) {
          results = results.filter((el) => el.locationId === query.where.locationId)
        }
        if (query.select && query.select.eventId) {
          results = results.map((el) => ({ eventId: el.eventId }))
        }
        return results
      },
      createMany: async ({ data: rows }) => {
        for (const row of rows) {
          data.eventLocations.push({ ...row })
        }
      },
    },
    _seed: (places, clusters, clusterPlaces, eventClusters, eventLocations) => {
      data.places = places
      data.clusters = clusters
      data.clusterPlaces = clusterPlaces || []
      data.eventClusters = eventClusters || []
      data.eventLocations = eventLocations || []
    },
    _getStore: () => data,
  }

  return prisma
}

function createMockTagService() {
  return {
    clearTagsCache: () => {},
  }
}

// ==================== Тесты ====================

describe('ClusterPlaceService.convertPolygonCoords', () => {
  it('должен конвертировать координаты из [lat,lng] в [lng,lat]', () => {
    const input = [
      [55.7, 37.6],
      [55.8, 37.7],
    ]
    const result = ClusterPlaceService.convertPolygonCoords(input)
    // Функция замыкает полигон, поэтому добавляем ожидаемую третью точку
    assert.strictEqual(result[0][0], 37.6)
    assert.strictEqual(result[0][1], 55.7)
    assert.strictEqual(result[1][0], 37.7)
    assert.strictEqual(result[1][1], 55.8)
    // и замыкание
    assert.strictEqual(result[2][0], 37.6)
    assert.strictEqual(result[2][1], 55.7)
  })

  it('должен замыкать полигон если первая точка не равна последней', () => {
    const input = [
      [55.7, 37.6],
      [55.8, 37.7],
    ]
    const result = ClusterPlaceService.convertPolygonCoords(input)
    assert.strictEqual(result.length, 3)
    assert.deepStrictEqual(result[0], result[2])
  })

  it('не замыкает полигон если первая точка равна последней', () => {
    const input = [
      [55.7, 37.6],
      [55.8, 37.7],
      [55.7, 37.6],
    ]
    const result = ClusterPlaceService.convertPolygonCoords(input)
    assert.strictEqual(result.length, 3)
  })
})

describe('ClusterPlaceService.associateClustersWithPolygons', () => {
  it('должен возвращать пустой массив для пустых кластеров', async () => {
    const prisma = createMockPrisma()
    const tagService = createMockTagService()
    const svc = new ClusterPlaceService(prisma, tagService)

    const result = await svc.associateClustersWithPolygons([])
    assert.deepStrictEqual(result, [])
  })

  it('должен возвращать пустой массив если нет мест с полигонами', async () => {
    const prisma = createMockPrisma()
    prisma._seed([{ id: 1, name: 'Place', polygon: null }])
    const tagService = createMockTagService()
    const svc = new ClusterPlaceService(prisma, tagService)

    const result = await svc.associateClustersWithPolygons([
      { id: 1, latitude: 55.7, longitude: 37.6 },
    ])
    assert.deepStrictEqual(result, [])
  })
})

describe('ClusterPlaceService.addClusterPlace', () => {
  it('должен создавать связь cluster-place', async () => {
    const prisma = createMockPrisma()
    prisma._seed([], [], [], [], [])
    const tagService = createMockTagService()
    const svc = new ClusterPlaceService(prisma, tagService)

    await svc.addClusterPlace(1, 1)
    const store = prisma._getStore()
    assert.strictEqual(store.clusterPlaces.length, 1)
    assert.strictEqual(store.clusterPlaces[0].clusterId, 1)
    assert.strictEqual(store.clusterPlaces[0].placeId, 1)
  })
})
