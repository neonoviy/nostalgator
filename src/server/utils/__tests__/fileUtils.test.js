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
  scanDirectory,
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
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
