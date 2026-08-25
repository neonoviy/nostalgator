import { ref } from 'vue'
import { getT } from '../i18n/composable.js'
import { addNotification, removeNotification } from './useNotifications.js'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../config.js'

const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]

export function useDragDrop(scanState, isUploaderRef) {
  const isDragging = ref(false)
  let dragCounter = 0

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

  const uploadFiles = async (files) => {
    if (files.length === 0) return

    const BATCH_SIZE = 10
    let uploaded = 0
    const failed = []
    const token = localStorage.getItem('auth_token')

    const t = getT()
    addNotification('progress', t('upload.progress'), { id: 'upload-progress', duration: 0 })

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)
      const formData = new FormData()
      batch.forEach((f) => formData.append('files', f))

      try {
        const response = await fetch('/api/import/upload', {
          method: 'POST',
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: formData,
        })

        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error?.message || err.error || t('upload.error.serverError', { status: response.status }))
        }

        const resultData = await response.json()
        const result = resultData.success ? resultData.data : resultData
        uploaded += result.uploaded
        if (result.failed?.length) failed.push(...result.failed)

        addNotification('progress', t('upload.uploaded', { uploaded, total: files.length }), {
          id: 'upload-progress',
          duration: 0,
        })
      } catch (error) {
        console.error('Failed to upload batch:', error)
        failed.push(...batch.map((f) => f.name))
      }
    }

    removeNotification('upload-progress')

    if (failed.length > 0) {
      addNotification('error', t('upload.errors', { uploaded, failed: failed.length }))
    } else {
      addNotification('success', t('upload.complete', { uploaded }))
    }
  }

  const handleDragEnter = (e) => {
    e.preventDefault()
    if (!scanState.importWatchEnabled.value) return
    dragCounter++
    if (dragCounter === 1) isDragging.value = true
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    if (!scanState.importWatchEnabled.value) return
    dragCounter--
    if (dragCounter === 0) isDragging.value = false
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    if (!scanState.importWatchEnabled.value) return
  }

  const handleDrop = async (e) => {
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

  const setupListeners = () => {
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
  }

  const cleanupListeners = () => {
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
