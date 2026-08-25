import { ref, onMounted, onBeforeUnmount, nextTick, watch, computed } from 'vue'
import { useWebSocket } from './useWebSocket'
import { getT } from '../i18n/composable.js'
import { addNotification, removeNotification } from './useNotifications.js'

/**
 * Composable for scan management
 */
export function useScan(isAdmin) {
  const t = getT()

  // WebSocket
  const ws = useWebSocket()

  // Auth (isAdmin passed from App.vue)

  // State
  const scanProcesses = ref({
    scanning: false,
    thumbnails: false,
    faces: false,
    places: false,
  })
  let afterScanCallback = null // Replacement for isManualScan flag
  const watchEnabled = ref(false)
  const importWatchEnabled = ref(false)
  const autodetectFacesEnabled = ref(true)
  const autodetectPlacesEnabled = ref(true)
  const scanAllowedGroupIds = ref(null)
  const forceFaces = ref(false)
  const forcePlaces = ref(false)
  const forceThumbs = ref(false)
  const scanLogs = ref([])
  const logsContainer = ref(null)
  const stats = ref({
    events: 0,
    media: 0,
    faces: 0,
    persons: 0,
    places: 0,
    clusters: 0,
  })

  // Computed: is any process active?
  const isScanning = computed(() => scanProcesses.value.scanning)
  const isAnyActive = computed(
    () =>
      scanProcesses.value.scanning ||
      scanProcesses.value.thumbnails ||
      scanProcesses.value.faces ||
      scanProcesses.value.places,
  )

  // Active processes for display
  const activeProcessLabels = computed(() => {
    const labels = []
    if (scanProcesses.value.scanning) labels.push(t('scan.processFolders'))
    if (scanProcesses.value.thumbnails) labels.push(t('scan.processThumbnails'))
    if (scanProcesses.value.faces) labels.push(t('scan.processFaces'))
    if (scanProcesses.value.places) labels.push(t('scan.processPlaces'))
    return labels
  })

  const getToken = () => {
    return localStorage.getItem('auth_token')
  }

  let pollInterval = null
  let loadingLogs = false
  let statsPollInterval = null

  // ============================================
  // Scanning
  // ============================================

  const startFullScan = async (
    selectedFolders = [],
    overrideForceFaces,
    overrideForcePlaces,
    overrideForceThumbs,
  ) => {
    scanProcesses.value.scanning = true

    await nextTick()

    try {
      const token = getToken()
      const response = await fetch('/api/scan/full', {
        method: 'POST',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          forceFaces: overrideForceFaces ?? forceFaces.value,
          forcePlaces: overrideForcePlaces ?? forcePlaces.value,
          forceThumbs: overrideForceThumbs ?? forceThumbs.value,
          folders: selectedFolders,
        }),
      })

      if (response.status === 409) {
        const data = await response.json()
        const errorData = data.success ? data.data : data
        addNotification(
          'warning',
          data.error?.message || errorData.error || t('scan.busy'),
          { duration: 5000 },
        )
        scanProcesses.value.scanning = false
        return
      }

      if (!response.ok) throw new Error(t('scan.error.scanError', { status: response.status }))
    } catch (error) {
      console.error('Failed to start scan:', error)
      addNotification('error', t('scan.error.scanErrorDetails', { message: error.message }))
      scanProcesses.value.scanning = false
    }
  }

  const pollServerLogs = async () => {
    await loadServerLogs()
    pollInterval = setTimeout(pollServerLogs, 500)
  }

  const loadServerLogs = async () => {
    if (loadingLogs) return
    loadingLogs = true
    try {
      const lastTs = scanLogs.value.length > 0 ? scanLogs.value[scanLogs.value.length - 1].ts : 0

      const token = getToken()
      const response = await fetch(`/api/scan/logs?since=${lastTs}`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
          'Cache-Control': 'no-cache',
        },
      })
      if (!response.ok) {
        return
      }

      const resData = await response.json()
      const data = resData.success ? resData.data : resData

      if (data.logs && data.logs.length > 0) {
        scanLogs.value.push(...data.logs)

        if (logsContainer.value) {
          logsContainer.value.scrollTop = logsContainer.value.scrollHeight
        }
      }
    } catch (error) {
      console.error('Failed to load server logs:', error)
    } finally {
      loadingLogs = false
    }
  }

  const cancelScan = async () => {
    try {
      const token = getToken()
      const response = await fetch('/api/scan/cancel', {
        method: 'POST',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      })

      if (!response.ok) {
        throw new Error(t('scan.error.cancelError', { status: response.status }))
      }

      scanProcesses.value.scanning = false
    } catch (error) {
      console.error('Failed to cancel scan:', error)
      addNotification('error', t('scan.error.cancelErrorDetails', { message: error.message }))
    }
  }

  // ============================================
  // Watching
  // ============================================

  const toggleWatch = async () => {
    try {
      const token = getToken()
      const newValue = !watchEnabled.value
      const payload = { originalsWatchEnabled: newValue }
      if (!newValue && importWatchEnabled.value) payload.importWatchEnabled = false

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(t('scan.errorStatus', { status: response.status }))

      const resultData = await response.json()
      const result = resultData.success ? resultData.data : resultData
      watchEnabled.value = result.settings.originalsWatchEnabled
      importWatchEnabled.value = result.settings.importWatchEnabled
    } catch (error) {
      console.error('Failed to toggle watch:', error)
      watchEnabled.value = !watchEnabled.value
      addNotification('error', t('scan.error.updateError', { message: error.message }))
    }
  }

  const toggleImportWatch = async () => {
    try {
      const token = getToken()
      const newValue = !importWatchEnabled.value
      const payload = { importWatchEnabled: newValue }
      if (newValue && !watchEnabled.value) payload.originalsWatchEnabled = true

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(t('scan.errorStatus', { status: response.status }))

      const resultData = await response.json()
      const result = resultData.success ? resultData.data : resultData
      importWatchEnabled.value = result.settings.importWatchEnabled
      if (result.settings.originalsWatchEnabled !== undefined)
        watchEnabled.value = result.settings.originalsWatchEnabled
    } catch (error) {
      console.error('Failed to toggle import watch:', error)
      importWatchEnabled.value = !importWatchEnabled.value
      addNotification('error', t('scan.error.updateError', { message: error.message }))
    }
  }

  const loadWatchSettings = async () => {
    try {
      const token = getToken()
      const response = await fetch('/api/settings', {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      })

      if (response.status === 503) return

      if (!response.ok) throw new Error(`Failed to load settings: ${response.status}`)

      const responseData = await response.json()
      const data = responseData.success ? responseData.data : responseData
      watchEnabled.value = data.originalsWatchEnabled ?? false
      importWatchEnabled.value = data.importWatchEnabled ?? false
      autodetectFacesEnabled.value = data.autodetectFacesEnabled ?? true
      autodetectPlacesEnabled.value = data.autodetectPlacesEnabled ?? true
      scanAllowedGroupIds.value = data.scanAllowedGroupIds ?? null
    } catch (error) {
      console.error('Failed to load watch settings:', error)
    }
  }

  const loadStats = async () => {
    try {
      const token = getToken()
      const response = await fetch('/api/scan/stats', {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
          'Cache-Control': 'no-cache',
        },
      })
      if (!response.ok) return

      const resData = await response.json()
      const data = resData.success ? resData.data : resData
      if (data) {
        stats.value.events = data.events ?? 0
        stats.value.media = data.media ?? 0
        stats.value.faces = data.faces ?? 0
        stats.value.persons = data.persons ?? 0
        stats.value.places = data.places ?? 0
        stats.value.clusters = data.clusters ?? 0
      }
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }

  const startStatsPollingDuringScan = () => {
    loadStats()
    if (statsPollInterval) clearInterval(statsPollInterval)
    statsPollInterval = setInterval(loadStats, 2000)
  }

  const stopStatsPollingDuringScan = () => {
    if (statsPollInterval) {
      clearInterval(statsPollInterval)
      statsPollInterval = null
    }
    loadStats()
  }

  const handleWatcherCycleComplete = () => {
    loadStats()
  }

  // ============================================
  // Scan status
  // ============================================
  // Deprecated — status arrives via WebSocket

  // Sync: if Originals is disabled — reset Import
  watch(watchEnabled, (enabled) => {
    if (!enabled && importWatchEnabled.value) {
      importWatchEnabled.value = false
    }
  })

  const checkScanStatus = async () => {
    try {
      const response = await fetch('/api/health')
      if (!response.ok) return

      const data = await response.json()
      scanProcesses.value.scanning = data.scanning || false
      scanProcesses.value.thumbnails = data.thumbnailQueueActive || false
    } catch (error) {
      console.error('Failed to check scan status:', error)
    }
  }

  // ============================================
  // Thumbnail queue
  // ============================================
  // Deprecated — now checked in checkScanStatus()

  // ============================================
  // Lifecycle
  // ============================================

  onMounted(() => {
    // Wait for server:ready before making requests to the server
    if (!ws.isServerReady.value) {
      const handler = () => {
        loadWatchSettings()
        checkScanStatus()
        pollServerLogs()
      }
      window.addEventListener('ws:server-ready', handler, { once: true })
    } else {
      loadWatchSettings()
      checkScanStatus()
      pollServerLogs()
    }

    watch(isAnyActive, (active) => {
      if (active) {
        startStatsPollingDuringScan()
      } else {
        stopStatsPollingDuringScan()
      }
    })

    window.addEventListener('ws:watcher:cycle-complete', handleWatcherCycleComplete)
    window.addEventListener('ws:scan-process-changed', handleScanProcessChanged)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('ws:scan-process-changed', handleScanProcessChanged)
    window.removeEventListener('ws:watcher:cycle-complete', handleWatcherCycleComplete)

    if (pollInterval) clearTimeout(pollInterval)
    stopStatsPollingDuringScan()
  })

  // ============================================
  // WebSocket event handlers
  // ============================================

  let lastActiveStates = { scanning: false, thumbnails: false, faces: false, places: false }

  const updateScanProgressNotification = () => {
    const anyActive = isAnyActive.value

    // Guard: skip if the set of active processes hasn't changed
    // (prevents flicker from per-item queue progress updates)
    const current = {
      scanning: scanProcesses.value.scanning,
      thumbnails: scanProcesses.value.thumbnails,
      faces: scanProcesses.value.faces,
      places: scanProcesses.value.places,
    }
    const statesChanged =
      current.scanning !== lastActiveStates.scanning ||
      current.thumbnails !== lastActiveStates.thumbnails ||
      current.faces !== lastActiveStates.faces ||
      current.places !== lastActiveStates.places

    if (!statesChanged) return
    lastActiveStates = { ...current }

    if (anyActive) {
      addNotification('progress', t('notification.scanProgress'), {
        duration: 0,
        id: 'scan-progress',
        processes: activeProcessLabels.value,
      })
    } else {
      removeNotification('scan-progress')
      if (afterScanCallback) {
        afterScanCallback()
        afterScanCallback = null
      }
    }
  }

  const handleScanProcessChanged = (event) => {
    const { process, active } = event.detail

    if (process in scanProcesses.value) {
      scanProcesses.value[process] = active
    }

    // Single notification with id 'scan-progress'
    // Display all active stages, remove only on full completion
    //
    // ⚠️ IMPORTANT: Scan processes run in parallel (scanning + thumbnails + faces + places).
    // Completion of ONE process does NOT mean scanning is complete.
    // Notification removal is ONLY when ALL processes are inactive.
    // afterScanCallback is called on full completion (scanning: false + nothing active).
    updateScanProgressNotification()
  }

  // ============================================
  // Export
  // ============================================

  // Setting scan completion handler
  const setScanCompletionHandler = (callback) => {
    afterScanCallback = callback
  }

  return {
    // State
    scanProcesses,
    isScanning,
    isAnyActive,
    activeProcessLabels,
    watchEnabled,
    importWatchEnabled,
    autodetectFacesEnabled,
    autodetectPlacesEnabled,
    scanAllowedGroupIds,
    forceFaces,
    forcePlaces,
    forceThumbs,
    scanLogs,
    logsContainer,
    stats,

    // Methods
    startFullScan,
    cancelScan,
    toggleWatch,
    toggleImportWatch,
    loadWatchSettings,
    loadStats,
    checkScanStatus,
    setScanCompletionHandler,
  }
}


