<template>
  <div class="notification-list">
    <TransitionGroup name="notification">
      <NotificationItem
        v-for="notification in notifications"
        :key="notification.id"
        :notification="notification"
        @close="removeNotification(notification.id)"
        @action="handleAction(notification)"
      />
    </TransitionGroup>
  </div>
</template>

<script setup>
  import { useNotifications } from '../../composables/useNotifications.js'
  import NotificationItem from './NotificationItem.vue'

  const { notifications, removeNotification } = useNotifications()

  const handleAction = (notification) => {
    if (notification.actionHandler) {
      notification.actionHandler()
    }
    removeNotification(notification.id)
  }
</script>
