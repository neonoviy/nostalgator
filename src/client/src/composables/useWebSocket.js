import { ref, onBeforeUnmount } from 'vue'

/**
 * Composable for managing the WebSocket connection.
 */
export function useWebSocket() {
  // State
  const isConnected = ref(false)
  const isServerReady = ref(false)
  const ws = ref(null)

  // WebSocket server URL — always the current origin so it works via Docker/proxy
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/ws`

  // Connect
  const connect = () => {
    if (ws.value) {
      return
    }

    ws.value = new WebSocket(wsUrl)

    ws.value.onopen = () => {
      isConnected.value = true
    }

    ws.value.onclose = () => {
      isConnected.value = false
      ws.value = null
      setTimeout(connect, 5000)
    }

    ws.value.onerror = (error) => {
      console.error('[WS] Error:', error)
    }

    ws.value.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        handleWebSocketMessage(message)
      } catch (error) {
        console.error('[WS] Parse error:', error)
      }
    }
  }

  // Message handling
  const handleWebSocketMessage = (message) => {
    const { type, data } = message

    switch (type) {
      case 'event:deleted':
      case 'events:changed':
        // Refresh events (only on delete or explicit change)
        window.dispatchEvent(new CustomEvent('ws:events-changed', { detail: data }))
        break

      case 'event:created':
        // Ignore creation via WS (handled by the watcher:cycle-complete event)
        break

      case 'scan:process-changed':
        window.dispatchEvent(new CustomEvent('ws:scan-process-changed', { detail: data }))
        break

      case 'scan:log':
        window.dispatchEvent(new CustomEvent('ws:scan-log', { detail: data }))
        break

      case 'server:ready':
        isServerReady.value = true
        window.dispatchEvent(new CustomEvent('ws:server-ready'))
        break

      case 'watcher:cycle-complete':
        window.dispatchEvent(new CustomEvent('ws:watcher:cycle-complete', { detail: data }))
        break

      case 'scan:pending-folders':
        window.dispatchEvent(new CustomEvent('ws:scan:pending-folders', { detail: data }))
        break

      case 'auth:logout':
        window.dispatchEvent(new CustomEvent('ws:auth-logout'))
        break

      case 'face:participants-changed':
        window.dispatchEvent(new CustomEvent('ws:face-participants-changed', { detail: data }))
        break

      default:
        break
    }
  }

  // Disconnect
  const disconnect = () => {
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    isConnected.value = false
  }

  // Connect synchronously when the composable is created
  connect()

  // When restored from the Back-Forward Cache the old WS is dead;
  // force-close it and reconnect.
  const handlePageShow = (event) => {
    if (event.persisted) {
      disconnect()
      connect()
    }
  }
  window.addEventListener('pageshow', handlePageShow)

  // Lifecycle
  onBeforeUnmount(() => {
    window.removeEventListener('pageshow', handlePageShow)
    disconnect()
  })

  return {
    // State
    isServerReady,

    // Methods
    connect,
    disconnect,
  }
}
