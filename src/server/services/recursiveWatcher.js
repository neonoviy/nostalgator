const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')

/**
 * Platform-aware recursive file watcher.
 *
 * On Windows / macOS uses a single native `fs.watch(root, { recursive: true })`
 * handle for the whole subtree — this avoids chokidar's per-directory
 * `ReadDirectoryChangesW` handles that exhaust file descriptors (EMFILE) on
 * large folder trees.
 *
 * On Linux native recursive watch is unsupported, so it falls back to chokidar
 * polling (`usePolling: true`) which sidesteps the inotify per-directory watch
 * limit that otherwise causes EMFILE.
 *
 * @param {string} rootPath absolute root to watch
 * @param {object} handlers
 * @param {Function} handlers.onFileAdded   (fullPath)
 * @param {Function} handlers.onFileRemoved (fullPath)  // file OR dir removed (native can't tell)
 * @param {Function} handlers.onDirAdded    (fullPath)
 * @param {Function} handlers.onDirRemoved  (fullPath)
 * @param {Function} handlers.onFileChanged (fullPath)
 * @param {Function} handlers.onError       (error)
 * @param {Function} [handlers.onUnknown]   () called when native watch emits null filename
 * @param {object}   [options]
 * @param {number}   [options.depth=10]     polling depth (Linux only)
 * @param {number}   [options.interval=5000] polling interval ms (Linux only)
 * @param {boolean}  [options.ignoreInitial=true] skip existing entries on startup (Linux only)
 * @returns {{ close: () => void, native: boolean }}
 */
function createRecursiveWatcher(rootPath, handlers, options = {}) {
  const depth = options.depth ?? 10
  const interval = options.interval ?? 5000
  const ignoreInitial = options.ignoreInitial ?? true
  const platform = process.platform

  const onError = handlers.onError || (() => {})

  // Windows and macOS support recursive fs.watch with a single handle.
  if (platform === 'win32' || platform === 'darwin') {
    const watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
      if (!filename) {
        // Under heavy load Windows may report the name as null — caller can rescan.
        if (handlers.onUnknown) handlers.onUnknown()
        return
      }

      const fullPath = path.join(rootPath, filename)

      if (eventType === 'change') {
        if (handlers.onFileChanged) handlers.onFileChanged(fullPath)
        return
      }

      // eventType === 'rename' -> added or removed
      fs.stat(fullPath, (err, stats) => {
        if (err) {
          // ENOENT: entry no longer exists -> removed (file or dir, unknown to us)
          if (handlers.onFileRemoved) handlers.onFileRemoved(fullPath)
          return
        }
        if (stats.isDirectory()) {
          if (handlers.onDirAdded) handlers.onDirAdded(fullPath)
        } else {
          if (handlers.onFileAdded) handlers.onFileAdded(fullPath)
        }
      })
    })

    watcher.on('error', onError)

    return {
      native: true,
      close: () => {
        watcher.close()
      },
    }
  }

  // Linux / other: chokidar polling fallback.
  const watcher = chokidar.watch(rootPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial,
    usePolling: true,
    interval,
    binaryInterval: interval,
    depth,
  })

  watcher
    .on('add', (p) => handlers.onFileAdded && handlers.onFileAdded(p))
    .on('unlink', (p) => handlers.onFileRemoved && handlers.onFileRemoved(p))
    .on('addDir', (p) => handlers.onDirAdded && handlers.onDirAdded(p))
    .on('unlinkDir', (p) => handlers.onDirRemoved && handlers.onDirRemoved(p))
    .on('change', (p) => handlers.onFileChanged && handlers.onFileChanged(p))
    .on('error', onError)

  return {
    native: false,
    close: () => {
      watcher.close()
    },
  }
}

module.exports = { createRecursiveWatcher }
