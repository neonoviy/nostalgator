const { describe, it } = require('node:test')
const assert = require('node:assert')

const {
  validateEventId,
  validateEventFilters,
  validateUpdateEventTags,
  validateUpdateEventPath,
  validateUpdateEventDate,
  validateExifPath,
  validateTagId,
  validateTagType,
  validateTagFilters,
  validateTagRename,
  validateLogin,
  validateProfileUpdate,
  validateSettingsUpdate,
} = require('../validators')

// ==================== Хелперы ====================

/** Создать mock req/res/next */
function makeReq({ params = {}, query = {}, body = {} } = {}) {
  return { params, query, body }
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

// ==================== validateEventId ====================

describe('validateEventId', () => {
  it('должен принимать корректный числовой ID', () => {
    const req = makeReq({ params: { id: '42' } })
    const res = makeRes()
    const next = makeNext()
    validateEventId(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.validatedEventId, 42)
  })

  it('должен отклонять строку как ID', () => {
    const req = makeReq({ params: { id: 'abc' } })
    const res = makeRes()
    const next = makeNext()
    validateEventId(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
    assert.strictEqual(res._jsonData.error, 'Invalid event ID')
  })

  it('должен отклонять отрицательный ID', () => {
    const req = makeReq({ params: { id: '-1' } })
    const res = makeRes()
    const next = makeNext()
    validateEventId(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять пустой ID', () => {
    const req = makeReq({ params: { id: '' } })
    const res = makeRes()
    const next = makeNext()
    validateEventId(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять дробный ID', () => {
    const req = makeReq({ params: { id: '1.5' } })
    const res = makeRes()
    const next = makeNext()
    validateEventId(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateEventFilters ====================

describe('validateEventFilters', () => {
  it('должен парсить JSON-массивы', () => {
    const req = makeReq({ query: { years: '[2024,2025]', search: 'Тест' } })
    const res = makeRes()
    const next = makeNext()
    validateEventFilters(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.deepStrictEqual(req.validatedFilters.years, [2024, 2025])
    assert.strictEqual(req.validatedFilters.search, 'Тест')
  })

  it('должен возвращать пустые массивы при невалидном JSON', () => {
    const req = makeReq({ query: { years: 'not-json' } })
    const res = makeRes()
    const next = makeNext()
    validateEventFilters(req, res, next)
    assert.deepStrictEqual(req.validatedFilters.years, [])
  })

  it('должен возвращать пустые массивы при отсутствии query', () => {
    const req = makeReq({ query: {} })
    const res = makeRes()
    const next = makeNext()
    validateEventFilters(req, res, next)
    assert.deepStrictEqual(req.validatedFilters.years, [])
    assert.strictEqual(req.validatedFilters.search, '')
  })

  it('должен декодировать search через decodeURIComponent', () => {
    const req = makeReq({ query: { search: '%D0%A2%D0%B5%D1%81%D1%82' } })
    const res = makeRes()
    const next = makeNext()
    validateEventFilters(req, res, next)
    assert.strictEqual(req.validatedFilters.search, 'Тест')
  })
})

// ==================== validateUpdateEventTags ====================

describe('validateUpdateEventTags', () => {
  it('должен принимать корректные массивы и title', () => {
    const req = makeReq({ body: { places: ['Москва'], tags: ['лето'], title: 'Отпуск' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventTags(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.deepStrictEqual(req.validatedBody.places, ['Москва'])
    assert.strictEqual(req.validatedBody.title, 'Отпуск')
  })

  it('должен отклонять places если это не массив', () => {
    const req = makeReq({ body: { places: 'Москва' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventTags(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять title с недопустимыми символами', () => {
    const req = makeReq({ body: { title: 'Отп<уск' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventTags(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять пустой title', () => {
    const req = makeReq({ body: { title: '   ' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventTags(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен принимать пустое тело', () => {
    const req = makeReq({ body: {} })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventTags(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })
})

// ==================== validateUpdateEventPath ====================

describe('validateUpdateEventPath', () => {
  it('должен принимать folderName', () => {
    const req = makeReq({ body: { folderName: '01.07 Отпуск' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventPath(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })

  it('должен принимать folderPath', () => {
    const req = makeReq({ body: { folderPath: '2026/01.07 Отпуск' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventPath(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })

  it('должен отклонять если оба поля отсутствуют', () => {
    const req = makeReq({ body: {} })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventPath(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять folderName с недопустимыми символами', () => {
    const req = makeReq({ body: { folderName: '01.07 Отп*уск' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventPath(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять пустой folderPath', () => {
    const req = makeReq({ body: { folderPath: '   ' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventPath(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateUpdateEventDate ====================

describe('validateUpdateEventDate', () => {
  it('должен принимать YYYY-MM-DD', () => {
    const req = makeReq({ body: { eventDate: '2026-04-10' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventDate(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.validatedBody.eventDate, '2026-04-10')
  })

  it('должен принимать null', () => {
    const req = makeReq({ body: { eventDate: null } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventDate(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.validatedBody.eventDate, null)
  })

  it('должен отклонять неверный формат', () => {
    const req = makeReq({ body: { eventDate: '10.04.2026' } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventDate(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять число вместо строки', () => {
    const req = makeReq({ body: { eventDate: 20260410 } })
    const res = makeRes()
    const next = makeNext()
    validateUpdateEventDate(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateExifPath ====================

describe('validateExifPath', () => {
  it('должен принимать корректный путь', () => {
    const req = makeReq({ params: { year: '2026', event: '01.07 Отпуск', filename: 'photo.jpg' } })
    const res = makeRes()
    const next = makeNext()
    validateExifPath(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })

  it('должен отклонять неверный год', () => {
    const req = makeReq({ params: { year: '26', event: '01.07', filename: 'photo.jpg' } })
    const res = makeRes()
    const next = makeNext()
    validateExifPath(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять пустой event', () => {
    const req = makeReq({ params: { year: '2026', event: '', filename: 'photo.jpg' } })
    const res = makeRes()
    const next = makeNext()
    validateExifPath(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateTagId ====================

describe('validateTagId', () => {
  it('должен принимать корректный ID', () => {
    const req = makeReq({ params: { id: '5' } })
    const res = makeRes()
    const next = makeNext()
    validateTagId(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.validatedTagId, 5)
  })

  it('должен отклонять нечисловой ID', () => {
    const req = makeReq({ params: { id: 'abc' } })
    const res = makeRes()
    const next = makeNext()
    validateTagId(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateTagType ====================

describe('validateTagType', () => {
  it('должен принимать валидные типы', () => {
    for (const type of ['places', 'eventTypes', 'participants', 'tags']) {
      const req = makeReq({ params: { type } })
      const res = makeRes()
      const next = makeNext()
      validateTagType(req, res, next)
      assert.strictEqual(next.wasCalled(), true, `Тип "${type}" должен пройти валидацию`)
      assert.strictEqual(req.validatedTagType, type)
    }
  })

  it('должен отклонять невалидный тип', () => {
    const req = makeReq({ params: { type: 'invalid' } })
    const res = makeRes()
    const next = makeNext()
    validateTagType(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateTagFilters ====================

describe('validateTagFilters', () => {
  it('должен парсить JSON-массивы', () => {
    const req = makeReq({ query: { places: '["Москва"]', eventTypes: '["свадьба"]' } })
    const res = makeRes()
    const next = makeNext()
    validateTagFilters(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.deepStrictEqual(req.validatedFilters.places, ['Москва'])
    assert.deepStrictEqual(req.validatedFilters.eventTypes, ['свадьба'])
  })

  it('должен возвращать пустые массивы при отсутствии query', () => {
    const req = makeReq({ query: {} })
    const res = makeRes()
    const next = makeNext()
    validateTagFilters(req, res, next)
    assert.deepStrictEqual(req.validatedFilters.places, [])
  })
})

// ==================== validateTagRename ====================

describe('validateTagRename', () => {
  it('должен принимать корректное имя', () => {
    const req = makeReq({ body: { name: 'Новое место' } })
    const res = makeRes()
    const next = makeNext()
    validateTagRename(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.validatedBody.name, 'Новое место')
  })

  it('должен trim-ить имя', () => {
    const req = makeReq({ body: { name: '  Москва  ' } })
    const res = makeRes()
    const next = makeNext()
    validateTagRename(req, res, next)
    assert.strictEqual(req.validatedBody.name, 'Москва')
  })

  it('должен отклонять пустое имя', () => {
    const req = makeReq({ body: { name: '' } })
    const res = makeRes()
    const next = makeNext()
    validateTagRename(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять отсутствие name', () => {
    const req = makeReq({ body: {} })
    const res = makeRes()
    const next = makeNext()
    validateTagRename(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateLogin ====================

describe('validateLogin', () => {
  it('должен принимать корректные credentials', () => {
    const req = makeReq({ body: { username: 'admin', password: 'secret' } })
    const res = makeRes()
    const next = makeNext()
    validateLogin(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
    assert.strictEqual(req.validatedBody.username, 'admin')
    assert.strictEqual(req.validatedBody.password, 'secret')
  })

  it('должен trim-ить username', () => {
    const req = makeReq({ body: { username: '  admin  ', password: 'secret' } })
    const res = makeRes()
    const next = makeNext()
    validateLogin(req, res, next)
    assert.strictEqual(req.validatedBody.username, 'admin')
  })

  it('должен отклонять пустой username', () => {
    const req = makeReq({ body: { username: '', password: 'secret' } })
    const res = makeRes()
    const next = makeNext()
    validateLogin(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять пустой password', () => {
    const req = makeReq({ body: { username: 'admin', password: '' } })
    const res = makeRes()
    const next = makeNext()
    validateLogin(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateProfileUpdate ====================

describe('validateProfileUpdate', () => {
  it('должен принимать только username', () => {
    const req = makeReq({ body: { username: 'newname' } })
    const res = makeRes()
    const next = makeNext()
    validateProfileUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })

  it('должен принимать смену пароля', () => {
    const req = makeReq({ body: { currentPassword: 'old', newPassword: 'new' } })
    const res = makeRes()
    const next = makeNext()
    validateProfileUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })

  it('должен отклонять newPassword без currentPassword', () => {
    const req = makeReq({ body: { newPassword: 'new' } })
    const res = makeRes()
    const next = makeNext()
    validateProfileUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять currentPassword без newPassword', () => {
    const req = makeReq({ body: { currentPassword: 'old' } })
    const res = makeRes()
    const next = makeNext()
    validateProfileUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })
})

// ==================== validateSettingsUpdate ====================

describe('validateSettingsUpdate', () => {
  it('должен принимать корректные булевы поля', () => {
    const req = makeReq({ body: { originalsWatchEnabled: true, importWatchEnabled: false } })
    const res = makeRes()
    const next = makeNext()
    validateSettingsUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })

  it('должен принимать корректный theme', () => {
    for (const theme of ['light', 'dark', 'auto']) {
      const req = makeReq({ body: { theme } })
      const res = makeRes()
      const next = makeNext()
      validateSettingsUpdate(req, res, next)
      assert.strictEqual(next.wasCalled(), true, `Theme "${theme}" должен пройти валидацию`)
    }
  })

  it('должен отклонять число вместо булева', () => {
    const req = makeReq({ body: { originalsWatchEnabled: 1 } })
    const res = makeRes()
    const next = makeNext()
    validateSettingsUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен отклонять невалидный theme', () => {
    const req = makeReq({ body: { theme: 'black' } })
    const res = makeRes()
    const next = makeNext()
    validateSettingsUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), false)
    assert.strictEqual(res._statusCode, 400)
  })

  it('должен принимать пустое тело', () => {
    const req = makeReq({ body: {} })
    const res = makeRes()
    const next = makeNext()
    validateSettingsUpdate(req, res, next)
    assert.strictEqual(next.wasCalled(), true)
  })
})
