<template>
  <Teleport :to="teleportTo">
    <Transition name="side-overlay">
      <div v-if="modelValue" class="side-overlay-backdrop" @click.self="handleOverlayClick">
        <div
          class="side-overlay"
          :class="contentClass"
          :style="{ '--side-overlay-width': width + 'px' }"
        >
          <div class="side-overlay__header">
            <h3>{{ title }}</h3>
            <button class="close-button" :aria-label="$t('modal.close')" @click="close">×</button>
          </div>
          <div class="side-overlay__body">
            <slot />
          </div>
          <div class="side-overlay__footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
  import { onMounted, onUnmounted } from 'vue'

  const props = defineProps({
    modelValue: {
      type: Boolean,
      required: true,
    },
    title: {
      type: String,
      default: '',
    },
    closeOnClickOutside: {
      type: Boolean,
      default: false,
    },
    closeOnEsc: {
      type: Boolean,
      default: true,
    },
    contentClass: {
      type: String,
      default: '',
    },
    width: {
      type: Number,
      default: 400,
    },
    teleportTo: {
      type: String,
      default: 'body',
    },
  })

  const emit = defineEmits(['update:modelValue', 'close'])

  const close = () => {
    emit('update:modelValue', false)
    emit('close')
  }

  const handleOverlayClick = () => {
    if (props.closeOnClickOutside) close()
  }

  const handleEsc = () => {
    if (props.closeOnEsc) close()
  }

  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      handleEsc()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
</script>
