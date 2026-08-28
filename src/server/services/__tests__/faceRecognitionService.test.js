const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const FaceRecognitionService = require('../faceRecognitionService')

function encodeDescriptor(vec) {
  const buf = Buffer.from(vec.buffer || vec)
  return buf.toString('base64')
}

function createMockPrisma() {
  const _store = {
    faces: [],
    persons: [],
    media: [],
    events: [],
    eventParticipants: [],
    participants: [],
  }

  let nextId = 1
  const genId = () => nextId++

  function mockModel(storeName) {
    return {
      findMany: async () => _store[storeName],
      findUnique: async ({ where }) => {
        if (where.id !== undefined) return _store[storeName].find((i) => i.id === where.id) || null
        if (where.eventId_participantId) {
          return (
            _store[storeName].find(
              (i) => i.eventId === where.eventId_participantId.eventId && i.participantId === where.eventId_participantId.participantId,
            ) || null
          )
        }
        return null
      },
      upsert: async ({ where, create }) => {
        const key = Object.keys(where)[0]
        const whereVal = where[key]
        let existing = _store[storeName].find((item) => {
          if (key === 'eventId_participantId') {
            return item.eventId === whereVal.eventId && item.participantId === whereVal.participantId
          }
          return item[key] === whereVal
        })
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
        if (where && where.eventId !== undefined) {
          _store[storeName] = _store[storeName].filter((i) => i.eventId !== where.eventId)
        } else {
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
        if (!where) return _store[storeName].length
        return _store[storeName].filter((item) => {
          for (const [key, val] of Object.entries(where)) {
            if (typeof val === 'object' && val !== null && 'not' in val) {
              if (item[key] === val.not) return false
            } else if (item[key] !== val) {
              return false
            }
          }
          return true
        }).length
      },
    }
  }

  const prisma = {
    person: mockModel('persons'),
    face: mockModel('faces'),
    media: mockModel('media'),
    event: {
      findUnique: async ({ where, select }) => {
        const ev = _store.events.find((e) => e.id === where.id)
        if (!ev) return null
        if (select) {
          const result = {}
          for (const key of Object.keys(select)) {
            result[key] = ev[key]
          }
          return result
        }
        return ev
      },
    },
    eventParticipant: mockModel('eventParticipants'),
    $queryRawUnsafe: async () => [],
    $transaction: async (fn) => fn(prisma),
    _getStore: () => _store,
    _nextId: () => nextId,
    _setNextId: (n) => {
      nextId = n
    },
  }

  return prisma
}

function createService(prisma) {
  return new FaceRecognitionService(prisma, '/tmp/originals', null)
}

// ==================== _loadKnownPersonsCache ====================

describe('FaceRecognitionService._loadKnownPersonsCache', () => {
  it('должен хранить participantId в кэше известных персон', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    const descriptorB64 = encodeDescriptor(new Float32Array([1, 0, 0]))
    prisma.$queryRawUnsafe = async () => [
      { id: 1, descriptor: descriptorB64, faceCount: 5, participantId: 10 },
      { id: 2, descriptor: descriptorB64, faceCount: 1, participantId: null },
    ]

    await svc._loadKnownPersonsCache()

    const knownEntry = svc._knownPersonsCache.get(1)
    assert.ok(knownEntry, 'Известная персона должна быть в known кэше')
    assert.strictEqual(knownEntry.participantId, 10, 'participantId должен сохраниться в кэше')

    const passerbyEntry = svc._passerbyPersonsCache.get(2)
    assert.ok(passerbyEntry, 'Персона с 1 лицом должна быть в passerby кэше')
    assert.strictEqual(passerbyEntry.participantId, null)
  })
})

// ==================== matchFace ====================

describe('FaceRecognitionService.matchFace', () => {
  it('не должен искать в passerbyCache вообще', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    const desc = new Float32Array([0, 1, 0])
    const passerbyEntry = {
      id: 2,
      participantId: null,
      _sum: new Float32Array([0, 3, 0]),
      _count: 3,
      _cachedAvg: new Float32Array([0, 1, 0]),
      _dirty: false,
    }

    const knownCache = new Map()
    const passerbyCache = new Map([[2, passerbyEntry]])

    const result = svc.matchFace(desc, knownCache, passerbyCache)
    assert.strictEqual(result, null, 'Не должно быть совпадений, если knownCache пуст, даже если passerbyCache имеет похожее лицо')
  })
})

// ==================== processEvent ====================

describe('FaceRecognitionService.processEvent — event participants', () => {
  it('должен создавать EventParticipant для matched персон с participantId', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    const descB64 = encodeDescriptor(new Float32Array([1, 0, 0]))
    prisma.$queryRawUnsafe = async () => []

    svc._knownPersonsCache = new Map([
      [
        1,
        {
          id: 1,
          participantId: 10,
          _sum: new Float32Array([3, 0, 0]),
          _count: 3,
          _cachedAvg: new Float32Array([1, 0, 0]),
          _dirty: false,
        },
      ],
    ])
    svc._passerbyPersonsCache = new Map()

    prisma.media.findMany = async () => [{ id: 1, filename: 'photo.jpg', width: 100, height: 100 }]
    prisma.event.findUnique = async () => ({ id: 1, folderPath: '2026/01', allowedGroupIds: 'g1' })

    svc.detectFaces = async () => [
      {
        file: 'photo.jpg',
        faces: [{ descriptor: descB64, x: 0, y: 0, w: 100, h: 100 }],
      },
    ]

    svc.writeFaces = async () => {}
    svc._ensureGpuDetected = async () => true

    const event = { id: 1, folderPath: '2026/01' }
    await svc.processEvent(event)

    const store = prisma._getStore()
    const ep = store.eventParticipants.find((ep) => ep.eventId === 1 && ep.participantId === 10)
    assert.ok(ep, 'EventParticipant должен быть создан для известной персоны с participantId')
    assert.strictEqual(ep.allowedGroupIds, 'g1')
  })

  it('не должен создавать EventParticipant для matched персон без participantId', async () => {
    const prisma = createMockPrisma()
    const svc = createService(prisma)

    const descB64 = encodeDescriptor(new Float32Array([1, 0, 0]))
    prisma.$queryRawUnsafe = async () => []

    svc._knownPersonsCache = new Map([
      [
        1,
        {
          id: 1,
          participantId: null,
          _sum: new Float32Array([3, 0, 0]),
          _count: 3,
          _cachedAvg: new Float32Array([1, 0, 0]),
          _dirty: false,
        },
      ],
    ])
    svc._passerbyPersonsCache = new Map()

    prisma.media.findMany = async () => [{ id: 1, filename: 'photo.jpg', width: 100, height: 100 }]
    prisma.event.findUnique = async () => ({ id: 1, folderPath: '2026/01', allowedGroupIds: 'g1' })

    svc.detectFaces = async () => [
      {
        file: 'photo.jpg',
        faces: [{ descriptor: descB64, x: 0, y: 0, w: 100, h: 100 }],
      },
    ]

    svc.writeFaces = async () => {}
    svc._ensureGpuDetected = async () => true

    const event = { id: 1, folderPath: '2026/01' }
    await svc.processEvent(event)

    const store = prisma._getStore()
    assert.strictEqual(store.eventParticipants.length, 0, 'EventParticipant не должен создаваться для персоны без participantId')
  })

  it('не должен создавать EventParticipant, если совпадений нет', async () => {
    const prisma = createMockPrisma()
    prisma._setNextId(100)
    const svc = createService(prisma)

    const descB64 = encodeDescriptor(new Float32Array([0, 1, 0]))
    prisma.$queryRawUnsafe = async () => []

    svc._knownPersonsCache = new Map([
      [
        1,
        {
          id: 1,
          participantId: 10,
          _sum: new Float32Array([3, 0, 0]),
          _count: 3,
          _cachedAvg: new Float32Array([1, 0, 0]),
          _dirty: false,
        },
      ],
    ])
    svc._passerbyPersonsCache = new Map()

    prisma.media.findMany = async () => [{ id: 1, filename: 'photo.jpg', width: 100, height: 100 }]
    prisma.event.findUnique = async () => ({ id: 1, folderPath: '2026/01', allowedGroupIds: 'g1' })

    svc.detectFaces = async () => [
      {
        file: 'photo.jpg',
        faces: [{ descriptor: descB64, x: 0, y: 0, w: 100, h: 100 }],
      },
    ]

    svc.writeFaces = async () => {}
    svc._ensureGpuDetected = async () => true

    const event = { id: 1, folderPath: '2026/01' }
    await svc.processEvent(event)

    const store = prisma._getStore()
    assert.strictEqual(store.eventParticipants.length, 0, 'EventParticipant не должен создаваться, если нет совпадений')
  })
})
