import { ref, computed, onMounted } from 'vue'
import { useWebSocket } from './useWebSocket'
import { getT } from '../i18n/composable.js'

/**
 * Composable for managing authentication
 */
export function useAuth() {
  const t = getT()
  const ws = useWebSocket()
  // State
  const user = ref(null)
  const token = ref(localStorage.getItem('auth_token') || null)
  const isLoading = ref(true)

  // Computed
  const isAuthenticated = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  // Check session on load
  const checkAuth = async () => {
    if (!token.value) {
      isLoading.value = false
      return
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token.value}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        const responseData = data.success ? data.data : data
        user.value = responseData.user
      } else if (response.status >= 500) {
        // Server not ready — do NOT log out, user will reload
        console.error('Auth check: server not ready (500/503)')
      } else {
        // Token invalid (401/403)
        logout()
      }
    } catch (error) {
      console.error('Auth check failed:', error)
    } finally {
      isLoading.value = false
    }
  }

  // Login
  const login = async (username, password) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.error || t('auth.loginError'))
      }

      const result = responseData.success ? responseData.data : responseData

      // Save token and user
      token.value = result.token
      user.value = result.user
      localStorage.setItem('auth_token', result.token)

      // Update isLoading
      isLoading.value = false

      return { success: true, user: result.user }
    } catch (error) {
      console.error('Login failed:', error)
      isLoading.value = false
      return { success: false, error: error.message }
    }
  }

  // Logout
  const logout = async () => {
    // Send request to server (non-blocking)
    if (token.value) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.value}`,
        },
      }).catch(() => {})
    }

    // Clear local state
    token.value = null
    user.value = null
    localStorage.removeItem('auth_token')
  }

  // Update user data
  const updateUser = (newUser) => {
    user.value = newUser
  }

  // Load on start
  onMounted(() => {
    if (ws.isServerReady.value) {
      checkAuth()
    } else {
      const timeout = setTimeout(() => {
        window.removeEventListener('ws:server-ready', onReady)
        checkAuth()
      }, 10000)
      const onReady = () => {
        clearTimeout(timeout)
        checkAuth()
      }
      window.addEventListener('ws:server-ready', onReady, { once: true })
    }
  })

  return {
    // State
    user,
    token,
    isLoading,

    // Computed
    isAuthenticated,
    isAdmin,

    // Methods
    login,
    logout,
    updateUser,
  }
}
