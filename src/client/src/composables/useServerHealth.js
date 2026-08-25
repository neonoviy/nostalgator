import { ref } from 'vue'

export function useServerHealth() {
  const isReady = ref(false)
  const isChecking = ref(false)
  let retryCount = 0
  let timer = null

  const checkHealth = async () => {
    if (isChecking.value) return
    isChecking.value = true

    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const data = await res.json()
        if (data.servicesReady) {
          isReady.value = true
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          return true
        }
      }
    } catch (e) {
    } finally {
      isChecking.value = false
    }

    retryCount++
    const delay = Math.min(1000 * Math.pow(1.5, retryCount), 30000)
    timer = setTimeout(checkHealth, delay)
    return false
  }

  const startChecking = () => {
    if (!isReady.value && !timer) {
      retryCount = 0
      timer = setTimeout(checkHealth, 500)
    }
  }

  const stopChecking = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { isReady, isChecking, startChecking, stopChecking }
}
