import { ref } from 'vue'

const notifications = ref([])
let nextId = 1

/**
 * Add notification
 * @param {string} type - 'info' | 'success' | 'warning' | 'error' | 'progress'
 * @param {string} message - notification text
 * @param {object} options - settings
 * @param {string} options.actionLabel - action button text
 * @param {Function} options.actionHandler - button handler
 * @param {number} options.duration - auto-close (ms), 0 = do not close
 * @param {string} options.id - custom ID (for updating existing)
 */
export function addNotification(type, message, options = {}) {
  const {
    actionLabel,
    actionHandler,
    duration = 5000,
    id,
    persistent = false,
    processes = undefined,
  } = options

  // If ID is provided and notification already exists — update it
  if (id) {
    const existing = notifications.value.find((n) => n.id === id)
    if (existing) {
      existing.type = type
      existing.message = message
      existing.actionLabel = actionLabel
      existing.actionHandler = actionHandler
      existing.duration = persistent ? 0 : duration
      existing.processes = processes
      return existing.id
    }
  }

  const notification = {
    id: id || nextId++,
    type,
    message,
    actionLabel,
    actionHandler,
    duration: persistent ? 0 : duration,
    processes,
  }

  notifications.value.push(notification)

  // Auto-close
  if (duration > 0 && !persistent) {
    setTimeout(() => removeNotification(notification.id), duration)
  }

  return notification.id
}

/**
 * Remove notification by ID
 */
export function removeNotification(id) {
  const index = notifications.value.findIndex((n) => n.id === id)
  if (index !== -1) {
    notifications.value.splice(index, 1)
  }
}

/**
 * Composable for use in components
 */
export function useNotifications() {
  return {
    notifications,
    addNotification,
    removeNotification,
  }
}
