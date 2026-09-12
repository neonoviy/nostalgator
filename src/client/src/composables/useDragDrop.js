import { ref } from 'vue'
import { getT } from '../i18n/composable.js'
import { addNotification } from './useNotifications.js'
import { uploadFiles } from './useFileUpload.js'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../config.js'

const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]

export function useDragDrop(scanState, isUploaderRef) {
  const isDragging = ref(false)
  let dragCounter = 0
  let internalDrag = false

  const isSupportedFile = (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    return ALL_EXTENSIONS.includes(ext)
  }

  const getFilesFromItemList = async (items) => {
    const files = []
    const unsupported = []

    const traverseEntry = (entry) => {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((file) => {
            if (isSupportedFile(file)) files.push(file)
            else unsupported.push(entry.name)
            resolve()
          })
        } else if (entry.isDirectory) {
          const reader = entry.createReader()
          const readAll = () => {
            reader.readEntries(async (entries) => {
              if (entries.length === 0) {
                resolve()
                return
              }
              for (const e of entries) await traverseEntry(e)
              readAll()
            })
          }
          readAll()
        } else {
          resolve()
        }
      })
    }

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      if (entry) await traverseEntry(entry)
    }

    return { files, unsupported }
  }

  const hasFileItems = (e) => {
    const types = e.dataTransfer?.types
    if (!types) return false
    return Array.from(types).includes('Files')
  }

  const handleDragEnter = (e) => {
    if (internalDrag) return
    if (!hasFileItems(e)) return
    e.preventDefault()
    if (!scanState.importWatchEnabled.value) return
    dragCounter++
    if (dragCounter === 1) isDragging.value = true
  }

  const handleDragLeave = (e) => {
    if (internalDrag) return
    if (!hasFileItems(e)) return
    e.preventDefault()
    if (!scanState.importWatchEnabled.value) return
    dragCounter--
    if (dragCounter === 0) isDragging.value = false
  }

  const handleDragOver = (e) => {
    if (internalDrag) return
    if (!hasFileItems(e)) return
    e.preventDefault()
    if (!scanState.importWatchEnabled.value) return
  }

  const handleDrop = async (e) => {
    if (internalDrag) return
    if (!hasFileItems(e)) return
    e.preventDefault()
    dragCounter = 0
    isDragging.value = false

    const t = getT()
    if (!scanState.importWatchEnabled.value) {
      addNotification('warning', t('upload.enableImportWatch'))
      return
    }

    if (isUploaderRef && !isUploaderRef.value) {
      addNotification('error', t('upload.noPermission'))
      return
    }

    const items = e.dataTransfer.items
    // Check if any dragged items are folders
    let hasFolders = false
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.()
        if (entry && entry.isDirectory) {
          hasFolders = true
          break
        }
      }
    }

    if (hasFolders) {
      // If there are folders — use recursive traversal
      const { files, unsupported } = await getFilesFromItemList(items)
      if (unsupported.length > 0) {
        addNotification('warning', t('upload.unsupportedSkipped', { count: unsupported.length }))
      }
      if (files.length > 0) await uploadFiles(files)
      else if (unsupported.length === 0) {
        addNotification('warning', t('upload.noFiles'))
      }
    } else {
      // If only files — take them directly via FileList (more reliable)
      const files = Array.from(e.dataTransfer.files).filter(isSupportedFile)
      if (files.length > 0) await uploadFiles(files)
      else addNotification('warning', t('upload.imagesAndVideoOnly'))
    }
  }

  const handleDragStart = () => {
    internalDrag = true
  }

  const handleDragEnd = () => {
    internalDrag = false
  }

  const setupListeners = () => {
    window.addEventListener('dragstart', handleDragStart)
    window.addEventListener('dragend', handleDragEnd)
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
  }

  const cleanupListeners = () => {
    window.removeEventListener('dragstart', handleDragStart)
    window.removeEventListener('dragend', handleDragEnd)
    window.removeEventListener('dragenter', handleDragEnter)
    window.removeEventListener('dragleave', handleDragLeave)
    window.removeEventListener('dragover', handleDragOver)
    window.removeEventListener('drop', handleDrop)
  }

  return {
    isDragging,
    setupListeners,
    cleanupListeners,
  }
}
