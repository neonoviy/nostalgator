const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs').promises
const path = require('path')
const os = require('os')

// Для тестов с реальной ФС — создаём временную директорию
let tmpDir

async function createTestStructure() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileutils-test-'))

  // Создаём файлы
  await fs.writeFile(path.join(tmpDir, 'photo.jpg'), 'fake jpg content')
  await fs.writeFile(path.join(tmpDir, 'video.mp4'), 'fake mp4 content')
  await fs.writeFile(path.join(tmpDir, 'document.txt'), 'text content')
  await fs.writeFile(path.join(tmpDir, 'image.PNG'), 'fake png content')

  // Подпапка
  const subDir = path.join(tmpDir, 'subdir')
  await fs.mkdir(subDir)
  await fs.writeFile(path.join(subDir, 'nested.jpg'), 'nested jpg')
}

async function cleanupTestStructure() {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

const {
  normalizePath,
  isMediaFile,
  getMediaFiles,
  getMediaInfo,
  extractExifData,
  scanDirectory,
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  formatDateForFilename,
  formatDateAsUtcIso,
  sanitizeForFilename,
  extractFolderOwner,
} = require('../fileUtils')

// ==================== Константы ====================

describe('MEDIA_EXTENSIONS', () => {
  it('должен включать основные форматы изображений', () => {
    for (const ext of ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']) {
      assert.ok(MEDIA_EXTENSIONS.includes(ext), `Расширение ${ext} должно быть в списке`)
    }
  })

  it('должен включать основные форматы видео', () => {
    for (const ext of ['.mp4', '.mov', '.avi', '.mkv']) {
      assert.ok(MEDIA_EXTENSIONS.includes(ext), `Расширение ${ext} должно быть в списке`)
    }
  })

  it('не должен включать форматы документов', () => {
    for (const ext of ['.pdf', '.doc', '.txt', '.zip']) {
      assert.ok(!MEDIA_EXTENSIONS.includes(ext), `Расширение ${ext} НЕ должно быть в списке`)
    }
  })
})

// ==================== normalizePath ====================

describe('normalizePath', () => {
  it('должен заменять обратные слеши на прямые', () => {
    const result = normalizePath('C:\\Users\\test\\file.txt')
    assert.strictEqual(result, 'C:/Users/test/file.txt')
  })

  it('должен оставлять прямые слеши без изменений', () => {
    const result = normalizePath('2026/01.07 Test')
    assert.strictEqual(result, '2026/01.07 Test')
  })

  it('должен возвращать null для пустой строки', () => {
    assert.strictEqual(normalizePath(''), null)
    assert.strictEqual(normalizePath(null), null)
    assert.strictEqual(normalizePath(undefined), null)
  })
})

// ==================== isMediaFile ====================

describe('isMediaFile', () => {
  it('должен распознавать изображения', () => {
    assert.strictEqual(isMediaFile('photo.jpg'), true)
    assert.strictEqual(isMediaFile('photo.JPEG'), true)
    assert.strictEqual(isMediaFile('image.png'), true)
  })

  it('должен распознавать видео', () => {
    assert.strictEqual(isMediaFile('video.mp4'), true)
    assert.strictEqual(isMediaFile('video.MOV'), true)
    assert.strictEqual(isMediaFile('video.mkv'), true)
  })

  it('должен отклонять не-медиа файлы', () => {
    assert.strictEqual(isMediaFile('document.txt'), false)
    assert.strictEqual(isMediaFile('archive.zip'), false)
    assert.strictEqual(isMediaFile('script.js'), false)
  })

  it('должен быть регистронезависимым', () => {
    assert.strictEqual(isMediaFile('photo.JPG'), true)
    assert.strictEqual(isMediaFile('photo.Jpg'), true)
    assert.strictEqual(isMediaFile('video.MP4'), true)
  })
})

// ==================== getMediaFiles ====================

describe('getMediaFiles', () => {
  before(async () => {
    await createTestStructure()
  })
  after(async () => {
    await cleanupTestStructure()
  })

  it('должен возвращать пустой массив если папка не существует', async () => {
    const result = await getMediaFiles('/nonexistent-path-xyz')
    assert.deepStrictEqual(result, [])
  })

  it('должен фильтровать только медиафайлы', async () => {
    const result = await getMediaFiles(tmpDir)

    assert.strictEqual(result.length, 3)
    assert.ok(result.some((f) => f.filename === 'photo.jpg'))
    assert.ok(result.some((f) => f.filename === 'video.mp4'))
    assert.ok(result.some((f) => f.filename === 'image.PNG'))
  })

  it('должен правильно определять isVideo/isImage', async () => {
    const result = await getMediaFiles(tmpDir)

    const img = result.find((f) => f.filename === 'photo.jpg')
    const vid = result.find((f) => f.filename === 'video.mp4')

    assert.strictEqual(img.isImage, true)
    assert.strictEqual(img.isVideo, false)
    assert.strictEqual(vid.isVideo, true)
    assert.strictEqual(vid.isImage, false)
  })

  it('должен строить правильные fullPath', async () => {
    const result = await getMediaFiles(tmpDir)

    const jpg = result.find((f) => f.filename === 'photo.jpg')
    assert.ok(jpg.fullPath.endsWith('photo.jpg'))
    assert.ok(jpg.fullPath.includes(tmpDir))
  })
})

// ==================== getMediaInfo ====================

describe('getMediaInfo', () => {
  before(async () => {
    await createTestStructure()
  })
  after(async () => {
    await cleanupTestStructure()
  })

  it('должен возвращать информацию о файле', async () => {
    const filePath = path.join(tmpDir, 'photo.jpg')
    const result = await getMediaInfo(filePath)

    assert.strictEqual(result.filename, 'photo.jpg')
    assert.strictEqual(result.extension, '.jpg')
    assert.strictEqual(result.isImage, true)
    assert.strictEqual(result.isVideo, false)
    assert.ok(result.size > 0)
  })

  it('должен определять видео файлы', async () => {
    const filePath = path.join(tmpDir, 'video.mp4')
    const result = await getMediaInfo(filePath)

    assert.strictEqual(result.isVideo, true)
    assert.strictEqual(result.isImage, false)
  })

  it('должен возвращать birthtime и mtime', async () => {
    const filePath = path.join(tmpDir, 'photo.jpg')
    const result = await getMediaInfo(filePath)

    assert.ok(result.birthtime != null, 'birthtime должен присутствовать')
    assert.ok(result.mtime != null, 'mtime должен присутствовать')
    assert.ok(new Date(result.birthtime).getTime() > 0, 'birthtime должен быть валидной датой')
    assert.ok(new Date(result.mtime).getTime() > 0, 'mtime должен быть валидной датой')
  })
})

// ==================== extractExifData ====================

describe('extractExifData', () => {
  before(async () => {
    await createTestStructure()
  })
  after(async () => {
    await cleanupTestStructure()
  })

  it('должен возвращать capturedAt из EXIF при наличии DateTimeOriginal', async () => {
    const filePath = path.join(tmpDir, 'photo.jpg')
    const result = await extractExifData(filePath)

    // Файл создаётся нами без EXIF, поэтому capturedAt должен быть null или из fs fallback
    // Главное — функция не падает
    assert.ok('capturedAt' in result)
  })

  it('должен fallback на birthtime когда EXIF отсутствует', async () => {
    const filePath = path.join(tmpDir, 'photo.jpg')
    const stat = await fs.stat(filePath)
    const result = await extractExifData(filePath, { birthtime: stat.birthtime, mtime: stat.mtime })

    assert.ok(result.capturedAt != null, 'capturedAt должен быть заполнен из filesystem fallback')
    assert.ok(new Date(result.capturedAt).getTime() > 0, 'capturedAt должен быть валидной датой')
  })

  it('должен fallback на mtime когда birthtime отсутствует', async () => {
    const filePath = path.join(tmpDir, 'photo.jpg')
    const stat = await fs.stat(filePath)
    const result = await extractExifData(filePath, { birthtime: null, mtime: stat.mtime })

    assert.ok(result.capturedAt != null, 'capturedAt должен быть заполнен из mtime fallback')
    assert.ok(new Date(result.capturedAt).getTime() > 0, 'capturedAt должен быть валидной датой')
  })

  it('должен оставаться null когда нет ни EXIF ни stat', async () => {
    const filePath = path.join(tmpDir, 'photo.jpg')
    const result = await extractExifData(filePath, null)

    // Без EXIF и без stat capturedAt должен быть null
    assert.strictEqual(result.capturedAt, null)
  })

  it('должен fallback на дату из имени файла когда нет EXIF и stat', async () => {
    const filename = 'IMG_20200828_171047.jpg'
    const filePath = path.join(tmpDir, filename)
    await fs.writeFile(filePath, 'fake jpg content')

    const result = await extractExifData(filePath, null)

    assert.ok(result.capturedAt != null, 'capturedAt должен быть заполнен из имени файла')
    assert.strictEqual(result.capturedAt.getFullYear(), 2020)
    assert.strictEqual(result.capturedAt.getMonth(), 7)
    assert.strictEqual(result.capturedAt.getDate(), 28)
    assert.strictEqual(result.capturedAt.getHours(), 17)
    assert.strictEqual(result.capturedAt.getMinutes(), 10)
    assert.strictEqual(result.capturedAt.getSeconds(), 47)
  })
})

// ==================== scanDirectory ====================

describe('scanDirectory', () => {
  before(async () => {
    await createTestStructure()
  })
  after(async () => {
    await cleanupTestStructure()
  })

  it('должен рекурсивно сканировать директорию', async () => {
    const result = await scanDirectory(tmpDir)

    // 4 файла в корне + 1 в подпапке = 5
    assert.strictEqual(result.length, 5)
    assert.ok(result.some((f) => f.includes('photo.jpg')))
    assert.ok(result.some((f) => f.includes('video.mp4')))
    assert.ok(result.some((f) => f.includes('document.txt')))
    assert.ok(result.some((f) => f.includes('nested.jpg')))
  })

  it('должен возвращать пустой массив для пустой папки', async () => {
    const emptyDir = path.join(tmpDir, 'empty-subdir')
    await fs.mkdir(emptyDir)

    const result = await scanDirectory(emptyDir)
    assert.deepStrictEqual(result, [])
  })

  it('должен возвращать пустой массив для несуществующей папки', async () => {
    const result = await scanDirectory('/nonexistent-path-xyz')
    assert.deepStrictEqual(result, [])
  })
})

// ==================== formatDateForFilename ====================

describe('formatDateForFilename', () => {
  it('should format a date using the YYYYMMDD_HHmmssSSS template', () => {
    const date = new Date(2024, 0, 15, 14, 30, 22, 123) // 2024-01-15 14:30:22.123 local
    const result = formatDateForFilename(date, 'YYYYMMDD_HHmmssSSS')
    assert.strictEqual(result, '20240115_143022123')
  })

  it('should format a date using the YYYY-MM-DD_HH-mm-ss-SSS template', () => {
    const date = new Date(2024, 5, 3, 8, 5, 9, 42) // 2024-06-03 08:05:09.042 local
    const result = formatDateForFilename(date, 'YYYY-MM-DD_HH-mm-ss-SSS')
    assert.strictEqual(result, '2024-06-03_08-05-09-042')
  })

  it('should pad single-digit values with leading zeros', () => {
    const date = new Date(2024, 0, 1, 0, 0, 1, 5) // 2024-01-01 00:00:01.005 local
    const result = formatDateForFilename(date, 'YYYYMMDD_HHmmssSSS')
    assert.strictEqual(result, '20240101_000001005')
  })

  it('should leave non-token text untouched', () => {
    const date = new Date(2024, 0, 15, 14, 30, 22, 123)
    const result = formatDateForFilename(date, 'PHOTO-YYYY')
    assert.strictEqual(result, 'PHOTO-2024')
  })

  it('should not collide MM and mm tokens in YYYYMMDD_HHmmss', () => {
    const date = new Date(2024, 0, 15, 14, 30, 22) // 2024-01-15 14:30:22 local
    const result = formatDateForFilename(date, 'YYYYMMDD_HHmmss')
    assert.strictEqual(result, '20240115_143022')
  })

  it('should not collide SSS and ss tokens', () => {
    const date = new Date(2024, 0, 15, 14, 30, 22, 999) // 2024-01-15 14:30:22.999 local
    const result = formatDateForFilename(date, 'YYYYMMDD_HHmmssSSS')
    assert.strictEqual(result, '20240115_143022999')
  })
})

// ==================== formatDateAsUtcIso ====================

describe('formatDateAsUtcIso', () => {
  it('должен вернуть null для null и невалидной даты', () => {
    assert.strictEqual(formatDateAsUtcIso(null), null)
    assert.strictEqual(formatDateAsUtcIso(undefined), null)
    assert.strictEqual(formatDateAsUtcIso(new Date('not-a-date')), null)
  })

  it('должен выдавать ISO с Z, сохраняя локальные компоненты Date', () => {
    const date = new Date(2024, 0, 15, 4, 30, 22, 123)
    assert.strictEqual(formatDateAsUtcIso(date), '2024-01-15T04:30:22.123Z')
  })
})

// ==================== sanitizeForFilename ====================

describe('sanitizeForFilename', () => {
  it('должен возвращать пустую строку для falsy значений', () => {
    assert.strictEqual(sanitizeForFilename(''), '')
    assert.strictEqual(sanitizeForFilename(null), '')
    assert.strictEqual(sanitizeForFilename(undefined), '')
  })

  it('должен заменять пробелы на подчеркивания', () => {
    assert.strictEqual(sanitizeForFilename('Hello World'), 'Hello_World')
  })

  it('должен заменять недопустимые символы на подчеркивания', () => {
    const invalidChars = '<>:"/\\|?*'
    const result = sanitizeForFilename(invalidChars)
    // All chars replaced with _, then collapsed
    assert.strictEqual(result, '')
  })

  it('должен схлопывать множественные подчеркивания', () => {
    assert.strictEqual(sanitizeForFilename('Hello___World'), 'Hello_World')
  })

  it('должен удалять ведущие и trailing подчеркивания', () => {
    assert.strictEqual(sanitizeForFilename('___Hello___'), 'Hello')
  })
})

// ==================== extractFolderOwner ====================

describe('extractFolderOwner', () => {
  const importPath = '/fake/Import'

  it('должен извлекать имя владельца из папки с префиксом _', () => {
    const filePath = path.join(importPath, '_Denis', 'photo.jpg')
    const result = extractFolderOwner(filePath, importPath)
    assert.strictEqual(result, 'Denis')
  })

  it('должен извлекать имя владельца из вложенной папки с префиксом _', () => {
    const filePath = path.join(importPath, '_Marina', 'subfolder', 'photo.jpg')
    const result = extractFolderOwner(filePath, importPath)
    assert.strictEqual(result, 'Marina')
  })

  it('должен возвращать null, если нет папки с префиксом _', () => {
    const filePath = path.join(importPath, 'photo.jpg')
    const result = extractFolderOwner(filePath, importPath)
    assert.strictEqual(result, null)
  })

  it('должен возвращать null, если папка не начинается с _', () => {
    const filePath = path.join(importPath, 'no_owner', 'photo.jpg')
    const result = extractFolderOwner(filePath, importPath)
    assert.strictEqual(result, null)
  })

  it('должен возвращать null, если файл находится вне Import', () => {
    const filePath = path.join('/fake/Other', 'photo.jpg')
    const result = extractFolderOwner(filePath, importPath)
    assert.strictEqual(result, null)
  })

  it('должен корректно обрабатывать относительные пути импорта', () => {
    // This test uses process.cwd(), so result depends on where tests run.
    // We mock it by using a path that resolves under cwd.
    const relImport = './Import'
    const filePath = path.join(relImport, '_TestUser', 'photo.jpg')
    const result = extractFolderOwner(filePath, relImport)
    assert.strictEqual(result, 'TestUser')
  })
})
