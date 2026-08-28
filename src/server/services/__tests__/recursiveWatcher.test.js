const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const chokidar = require('chokidar')

const { createRecursiveWatcher } = require('../recursiveWatcher')

function setPlatform(platform) {
  const prev = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return () => Object.defineProperty(process, 'platform', { value: prev, configurable: true })
}

function makeHandlers() {
  const calls = { fileAdded: [], fileRemoved: [], dirAdded: [], dirRemoved: [], fileChanged: [], unknown: [], error: [] }
  return {
    calls,
    handlers: {
      onFileAdded: (p) => calls.fileAdded.push(p),
      onFileRemoved: (p) => calls.fileRemoved.push(p),
      onDirAdded: (p) => calls.dirAdded.push(p),
      onDirRemoved: (p) => calls.dirRemoved.push(p),
      onFileChanged: (p) => calls.fileChanged.push(p),
      onUnknown: () => calls.unknown.push(true),
      onError: (e) => calls.error.push(e),
    },
  }
}

test('native (win32): change event -> onFileChanged', () => {
  const restore = setPlatform('win32')
  const fakeWatcher = { on: () => fakeWatcher, close: () => {} }
  const origWatch = fs.watch
  let cb
  fs.watch = (root, opts, callback) => {
    cb = callback
    return fakeWatcher
  }
  try {
    const { calls, handlers } = makeHandlers()
    createRecursiveWatcher('P:\\Originals', handlers)
    cb('change', '2012\\12.26 Event\\a.jpg')
    assert.deepStrictEqual(calls.fileChanged, ['P:\\Originals\\2012\\12.26 Event\\a.jpg'])
  } finally {
    fs.watch = origWatch
    restore()
  }
})

test('native (win32): rename + existing file -> onFileAdded', () => {
  const restore = setPlatform('win32')
  const fakeWatcher = { on: () => fakeWatcher, close: () => {} }
  const origWatch = fs.watch
  const origStat = fs.stat
  let cb
  fs.watch = (root, opts, callback) => {
    cb = callback
    return fakeWatcher
  }
  fs.stat = (p, callback) => callback(null, { isDirectory: () => false })
  try {
    const { calls, handlers } = makeHandlers()
    createRecursiveWatcher('P:\\Originals', handlers)
    cb('rename', '2012\\12.26 Event\\a.jpg')
    assert.deepStrictEqual(calls.fileAdded, ['P:\\Originals\\2012\\12.26 Event\\a.jpg'])
    assert.strictEqual(calls.fileRemoved.length, 0)
  } finally {
    fs.watch = origWatch
    fs.stat = origStat
    restore()
  }
})

test('native (win32): rename + existing dir -> onDirAdded', () => {
  const restore = setPlatform('win32')
  const fakeWatcher = { on: () => fakeWatcher, close: () => {} }
  const origWatch = fs.watch
  const origStat = fs.stat
  let cb
  fs.watch = (root, opts, callback) => {
    cb = callback
    return fakeWatcher
  }
  fs.stat = (p, callback) => callback(null, { isDirectory: () => true })
  try {
    const { calls, handlers } = makeHandlers()
    createRecursiveWatcher('P:\\Originals', handlers)
    cb('rename', '2012\\12.26 Event')
    assert.deepStrictEqual(calls.dirAdded, ['P:\\Originals\\2012\\12.26 Event'])
  } finally {
    fs.watch = origWatch
    fs.stat = origStat
    restore()
  }
})

test('native (win32): rename + ENOENT -> onFileRemoved (unknown file/dir)', () => {
  const restore = setPlatform('win32')
  const fakeWatcher = { on: () => fakeWatcher, close: () => {} }
  const origWatch = fs.watch
  const origStat = fs.stat
  let cb
  fs.watch = (root, opts, callback) => {
    cb = callback
    return fakeWatcher
  }
  fs.stat = (p, callback) => callback({ code: 'ENOENT' })
  try {
    const { calls, handlers } = makeHandlers()
    createRecursiveWatcher('P:\\Originals', handlers)
    cb('rename', '2012\\12.26 Event\\a.jpg')
    assert.deepStrictEqual(calls.fileRemoved, ['P:\\Originals\\2012\\12.26 Event\\a.jpg'])
  } finally {
    fs.watch = origWatch
    fs.stat = origStat
    restore()
  }
})

test('native (win32): null filename -> onUnknown', () => {
  const restore = setPlatform('win32')
  const fakeWatcher = { on: () => fakeWatcher, close: () => {} }
  const origWatch = fs.watch
  let cb
  fs.watch = (root, opts, callback) => {
    cb = callback
    return fakeWatcher
  }
  try {
    const { calls, handlers } = makeHandlers()
    createRecursiveWatcher('P:\\Originals', handlers)
    cb('rename', null)
    assert.strictEqual(calls.unknown.length, 1)
  } finally {
    fs.watch = origWatch
    restore()
  }
})

test('native (darwin) also uses single-handle watch', () => {
  const restore = setPlatform('darwin')
  const fakeWatcher = { on: () => fakeWatcher, close: () => {} }
  const origWatch = fs.watch
  let called = false
  fs.watch = (root, opts, callback) => {
    called = true
    assert.strictEqual(opts.recursive, true)
    return fakeWatcher
  }
  try {
    const { handlers } = makeHandlers()
    const w = createRecursiveWatcher('/Originals', handlers)
    assert.strictEqual(called, true)
    assert.strictEqual(w.native, true)
  } finally {
    fs.watch = origWatch
    restore()
  }
})

test('linux: chokidar polling fallback wires handlers and passes ignoreInitial', () => {
  const restore = setPlatform('linux')
  const origWatch = chokidar.watch
  let capturedOptions
  const eventHandlers = {}
  const fakeWatcher = {
    on: (event, cb) => {
      eventHandlers[event] = cb
      return fakeWatcher
    },
    close: () => {},
  }
  chokidar.watch = (root, options) => {
    capturedOptions = options
    return fakeWatcher
  }
  try {
    const { calls, handlers } = makeHandlers()
    const w = createRecursiveWatcher('/Originals', handlers, { ignoreInitial: false })
    assert.strictEqual(w.native, false)
    assert.strictEqual(capturedOptions.usePolling, true)
    assert.strictEqual(capturedOptions.ignoreInitial, false)

    eventHandlers.add('/Originals/2012/x/a.jpg')
    eventHandlers.unlink('/Originals/2012/x/a.jpg')
    eventHandlers.addDir('/Originals/2012/x')
    eventHandlers.unlinkDir('/Originals/2012/x')
    eventHandlers.change('/Originals/2012/x/a.jpg')
    eventHandlers.error(new Error('boom'))

    assert.deepStrictEqual(calls.fileAdded, ['/Originals/2012/x/a.jpg'])
    assert.deepStrictEqual(calls.fileRemoved, ['/Originals/2012/x/a.jpg'])
    assert.deepStrictEqual(calls.dirAdded, ['/Originals/2012/x'])
    assert.deepStrictEqual(calls.dirRemoved, ['/Originals/2012/x'])
    assert.deepStrictEqual(calls.fileChanged, ['/Originals/2012/x/a.jpg'])
    assert.strictEqual(calls.error.length, 1)
  } finally {
    chokidar.watch = origWatch
    restore()
  }
})
