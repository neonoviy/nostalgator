<template>
  <Teleport to="body">
    <div class="drop-overlay" :class="{ 'is-hidden': !isDragging }">
      <div class="drop-box">
        <span class="drop-icon">📁</span>
        <p class="drop-title">{{ $t('drop.title') }}</p>
        <p class="drop-hint">{{ $t('drop.hint') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
  defineProps({
    isDragging: { type: Boolean, default: false },
  })
</script>
