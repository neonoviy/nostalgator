import { getT } from '../i18n/composable.js'
import { addNotification, removeNotification } from './useNotifications.js'

const BATCH_SIZE = 10

export async function uploadFiles(files) {
  if (!files || files.length === 0) return

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
        throw new Error(
          err.error?.message || err.error || t('upload.error.serverError', { status: response.status }),
        )
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
