<template>
  <div class="notification-item" :class="notification.type">
    <span class="notification-icon">{{ icon }}</span>
    <span class="notification-message">
      <span class="notification-header">{{ notification.message }}</span>
      <span
        v-if="notification.processes && notification.processes.length"
        class="notification-processes"
      >
        <span v-for="p in notification.processes" :key="p" class="notification-process-item">{{
          p
        }}</span>
      </span>
    </span>
    <button
      v-if="notification.actionLabel"
      class="app-button notification-action"
      @click="$emit('action')"
    >
      {{ notification.actionLabel }}
    </button>
    <button class="notification-close" @click="$emit('close')">✕</button>
  </div>
</template>

<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    notification: { type: Object, required: true },
  })

  defineEmits(['close', 'action'])

  const icon = computed(() => {
    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌',
      progress: '⏳',
    }
    return icons[props.notification.type] || 'ℹ️'
  })
</script>
