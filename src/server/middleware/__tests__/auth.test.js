const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const { optionalAuth, requireAuth, requireAdmin, setAuthService } = require('../auth')

// ==================== Хелперы ====================

function makeReq({ headers = {}, user } = {}) {
  const req = { headers }
  if (user !== undefined) req.user = user
  return req
}

function makeRes() {
  const res = {}
  res.status = (code) => {
    res._statusCode = code
    return res
  }
  res.json = (data) => {
    res._jsonData = data
    return res
  }
  return res
}

function makeNext() {
  let called = false
  const next = () => {
    called = true
  }
  next.wasCalled = () => called
  return next
}

// ==================== optionalAuth ====================

describe('optionalAuth', () => {
  it('должен ставить req.user = null если нет токена', async () => {
    const req = makeReq({ headers: {} })
    const res = makeRes()
    const next = makeNext()

    await optionalAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.user, null)
  })

  it('должен ставить req.user = null если authService не установлен', async () => {
    setAuthService(null)

    const req = makeReq({ headers: { authorization: 'Bearer some-token' } })
    const res = makeRes()
    const next = makeNext()

    await optionalAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.user, null)

    // Восстановим сервис
    setAuthService({ validateToken: async () => null })
  })

  it('должен ставить req.user = null если токен невалидный', async () => {
    const mockAuthService = {
      validateToken: async () => null,
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer invalid-token' } })
    const res = makeRes()
    const next = makeNext()

    await optionalAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.user, null)
  })

  it('должен ставить req.user если токен валидный', async () => {
    const mockAuthService = {
      validateToken: async () => ({
        user: { id: 1, username: 'admin', role: 'admin' },
        expiresAt: new Date(Date.now() + 3600000),
      }),
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer valid-token' } })
    const res = makeRes()
    const next = makeNext()

    await optionalAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.deepStrictEqual(req.user, { id: 1, username: 'admin', role: 'admin' })
  })

  it('должен ставить req.user = null при ошибке validateToken', async () => {
    const mockAuthService = {
      validateToken: async () => {
        throw new Error('DB error')
      },
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer valid-token' } })
    const res = makeRes()
    const next = makeNext()

    await optionalAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.user, null)
  })

  it('должен работать для обычного пользователя', async () => {
    const mockAuthService = {
      validateToken: async () => ({
        user: { id: 2, username: 'user', role: 'user' },
        expiresAt: new Date(Date.now() + 3600000),
      }),
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer valid-token' } })
    const res = makeRes()
    const next = makeNext()

    await optionalAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.deepStrictEqual(req.user, { id: 2, username: 'user', role: 'user' })
  })
})

// ==================== requireAuth ====================

describe('requireAuth', () => {
  it('должен отклонять запрос без токена (без optionalAuth)', async () => {
    const req = makeReq({ headers: {} })
    const res = makeRes()
    const next = makeNext()

    await requireAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 401)
    assert.strictEqual(res._jsonData.error, 'Authentication required')
  })

  it('должен отклонять если req.user = null (после optionalAuth)', async () => {
    const req = makeReq({ headers: {}, user: null })
    const res = makeRes()
    const next = makeNext()

    await requireAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 401)
    assert.strictEqual(res._jsonData.error, 'Authentication required')
  })

  it('должен пропускать если req.user уже установлен (после optionalAuth)', async () => {
    const req = makeReq({ headers: {}, user: { id: 1, username: 'admin', role: 'admin' } })
    const res = makeRes()
    const next = makeNext()

    await requireAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
  })

  it('должен отклонять пустой токен', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer ' } })
    const res = makeRes()
    const next = makeNext()

    await requireAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 401)
  })

  it('должен пропускать валидный токен (без optionalAuth)', async () => {
    const mockAuthService = {
      validateToken: async () => ({
        user: { id: 1, username: 'admin', role: 'admin' },
        expiresAt: new Date(Date.now() + 3600000),
      }),
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer valid-token' } })
    const res = makeRes()
    const next = makeNext()

    await requireAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.deepStrictEqual(req.user, { id: 1, username: 'admin', role: 'admin' })
  })

  it('должен отклонять просроченный токен (без optionalAuth)', async () => {
    const mockAuthService = {
      validateToken: async () => null,
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer expired-token' } })
    const res = makeRes()
    const next = makeNext()

    await requireAuth(req, res, next)

    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 401)
    assert.strictEqual(res._jsonData.error, 'Invalid or expired token')
  })
})

// ==================== requireAdmin ====================

describe('requireAdmin', () => {
  it('должен отклонять запрос без токена', async () => {
    const req = makeReq({ headers: {} })
    const res = makeRes()
    const next = makeNext()

    await requireAdmin(req, res, next)

    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 401)
  })

  it('должен отклонять пользователя без роли admin', async () => {
    const mockAuthService = {
      validateToken: async () => ({
        user: { id: 2, username: 'user', role: 'user' },
        expiresAt: new Date(Date.now() + 3600000),
      }),
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer valid-token' } })
    const res = makeRes()
    const next = makeNext()

    await requireAdmin(req, res, next)

    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 403)
    assert.strictEqual(res._jsonData.error, 'Access denied. Admin privileges required.')
  })

  it('должен пропускать пользователя с ролью admin', async () => {
    const mockAuthService = {
      validateToken: async () => ({
        user: { id: 1, username: 'admin', role: 'admin' },
        expiresAt: new Date(Date.now() + 3600000),
      }),
    }
    setAuthService(mockAuthService)

    const req = makeReq({ headers: { authorization: 'Bearer valid-token' } })
    const res = makeRes()
    const next = makeNext()

    await requireAdmin(req, res, next)

    assert.strictEqual(next.wasCalled(), true)
    assert.deepStrictEqual(req.user, { id: 1, username: 'admin', role: 'admin' })
  })
})
