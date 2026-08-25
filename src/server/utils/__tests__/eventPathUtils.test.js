const { describe, it } = require('node:test')
const assert = require('node:assert')

const {
  parseEventFolderName,
  isValidDate,
  formatDate,
  isEventFolder,
  isYearFolder,
  buildEventPath,
  buildEventDate,
} = require('../eventPathUtils')

// ==================== parseEventFolderName ====================

describe('parseEventFolderName', () => {
  it('должен парсить MM.DD формат с названием', () => {
    const result = parseEventFolderName('01.07 Unreal', '2026')
    assert.notStrictEqual(result.date, null)
    assert.strictEqual(formatDate(result.date), '2026-01-07')
    assert.strictEqual(result.title, '01.07 Unreal')
    assert.strictEqual(result.confidence, 0.9)
  })

  it('должен парсить YYYY-MM-DD формат', () => {
    const result = parseEventFolderName('2026-01-07 Unreal', '2025')
    assert.strictEqual(formatDate(result.date), '2026-01-07')
    assert.strictEqual(result.confidence, 1.0)
  })

  it('должен парсить YYYY.MM.DD формат', () => {
    const result = parseEventFolderName('2026.01.07 Unreal', '2025')
    assert.strictEqual(formatDate(result.date), '2026-01-07')
    assert.strictEqual(result.confidence, 1.0)
  })

  it('должен парсить MM.DD.YYYY формат', () => {
    const result = parseEventFolderName('01.07.2026 Unreal', '2025')
    assert.strictEqual(formatDate(result.date), '2026-01-07')
    assert.strictEqual(result.confidence, 0.9)
  })

  it('должен возвращать null для нераспознанного формата', () => {
    const result = parseEventFolderName('Лизе 1 год', '2026')
    assert.strictEqual(result.date, null)
    assert.strictEqual(result.confidence, 0)
    assert.strictEqual(result.title, 'Лизе 1 год')
  })

  it('должен возвращать пустой результат для пустой строки', () => {
    const result = parseEventFolderName('', '2026')
    assert.strictEqual(result.date, null)
    assert.strictEqual(result.confidence, 0)
    assert.strictEqual(result.title, '')
  })

  it('должен отклонять невалидную дату (30 февраля)', () => {
    const result = parseEventFolderName('02.30 Событие', '2026')
    assert.strictEqual(result.date, null)
    assert.strictEqual(result.confidence, 0)
  })
})

// ==================== isEventFolder ====================

describe('isEventFolder', () => {
  it('должен распознавать MM.DD как событие', () => {
    assert.strictEqual(isEventFolder('01.07 Unreal'), true)
  })

  it('должен распознавать YYYY-MM-DD как событие', () => {
    assert.strictEqual(isEventFolder('2026-01-07'), true)
  })

  it('должен отклонять текст без даты', () => {
    assert.strictEqual(isEventFolder('Лизе 1 год'), false)
  })
})

// ==================== isYearFolder ====================

describe('isYearFolder', () => {
  it('должен распознавать 4 цифры как год', () => {
    assert.strictEqual(isYearFolder('2026'), true)
  })

  it('должен отклонять не-год', () => {
    assert.strictEqual(isYearFolder('Лизе 1 год'), false)
    assert.strictEqual(isYearFolder('01.07'), false)
  })
})

// ==================== formatDate ====================

describe('formatDate', () => {
  it('должен форматировать дату в ISO', () => {
    const date = new Date('2026-01-07')
    assert.strictEqual(formatDate(date), '2026-01-07')
  })

  it('должен возвращать пустую строку для невалидной даты', () => {
    assert.strictEqual(formatDate(null), '')
    assert.strictEqual(formatDate(new Date(NaN)), '')
  })
})

// ==================== buildEventPath ====================

describe('buildEventPath', () => {
  it('должен строить путь из года и имени папки', () => {
    const result = buildEventPath('2026', '01.07 Unreal')
    assert.strictEqual(result, '2026/01.07 Unreal')
  })
})

// ==================== buildEventDate ====================

describe('buildEventDate', () => {
  it('должен создавать дату из компонентов', () => {
    const result = buildEventDate('2026', '01', '07')
    assert.strictEqual(formatDate(result), '2026-01-07')
  })
})
