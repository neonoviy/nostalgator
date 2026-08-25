const { describe, it } = require('node:test')
const assert = require('node:assert')
const { errorHandler, notFoundHandler } = require('../errorHandler')

// ==================== Хелперы ====================

function makeReq() {
  return { headers: {} }
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

// ==================== errorHandler ====================

describe('errorHandler', () => {
  it('должен возвращать 500 и сообщение об ошибке', () => {
    const req = makeReq()
    const res = makeRes()
    const next = makeNext()

    const err = new Error('Что-то пошло не так')
    errorHandler(err, req, res, next)

    assert.strictEqual(res._statusCode, 500)
    assert.strictEqual(res._jsonData.error, 'Что-то пошло не так')
  })

  it('должен использовать кастомный statusCode если он есть', () => {
    const req = makeReq()
    const res = makeRes()
    const next = makeNext()

    const err = new Error('Не найдено')
    err.statusCode = 404
    errorHandler(err, req, res, next)

    assert.strictEqual(res._statusCode, 404)
    assert.strictEqual(res._jsonData.error, 'Не найдено')
  })

  it('должен добавлять stack только в development', () => {
    const originalEnv = process.env.NODE_ENV
    const req = makeReq()
    const res = makeRes()
    const next = makeNext()

    const err = new Error('Ошибка')
    err.stack = 'Error: Ошибка\n    at test.js:1'

    // Development — stack есть
    process.env.NODE_ENV = 'development'
    errorHandler(err, req, res, next)
    assert.ok(res._jsonData.stack, 'Stack должен быть в development')

    // Production — stack нет
    process.env.NODE_ENV = 'production'
    const res2 = makeRes()
    errorHandler(err, req, res2, next)
    assert.strictEqual(res2._jsonData.stack, undefined, 'Stack не должен быть в production')

    process.env.NODE_ENV = originalEnv
  })

  it('должен использовать дефолтное сообщение если его нет', () => {
    const req = makeReq()
    const res = makeRes()
    const next = makeNext()

    const err = new Error()
    errorHandler(err, req, res, next)

    assert.strictEqual(res._jsonData.error, 'Internal server error')
  })
})

// ==================== notFoundHandler ====================

describe('notFoundHandler', () => {
  it('должен возвращать 404', () => {
    const req = makeReq()
    const res = makeRes()
    const next = makeNext()

    notFoundHandler(req, res, next)

    assert.strictEqual(res._statusCode, 404)
    assert.strictEqual(res._jsonData.error, 'The requested resource was not found')
  })
})
