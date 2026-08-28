<template>
  <div
    class="dropdown"
    :class="[
      { 'dropdown--open': isOpen },
      `dropdown--${placement}`,
      className,
    ]"
  >
    <!-- Button -->
    <button
      ref="buttonRef"
      class="dropdown__button"
      :class="{ active: isOpen }"
      @click="toggle"
      @keydown="handleKeydown"
      :aria-expanded="isOpen"
      :aria-haspopup="true"
    >
      <slot name="button" :is-open="isOpen" :toggle="toggle">
        <span class="dropdown__button-text">
          <slot name="button-content"></slot>
        </span>
        <span
          v-if="showCaret"
          class="dropdown__caret"
          :class="{ 'dropdown__caret--rotated': isOpen }"
        >
          {{ caretIcon }}
        </span>
      </slot>
    </button>
  </div>

  <!-- Dropdown content (Teleport to body) -->
  <Teleport to="body">
    <Transition name="dropdown">
      <div
        v-if="isOpen"
        ref="contentRef"
        class="dropdown__content dropdown__content--teleported"
        :style="contentStyle"
        @click="handleContentClick"
        @keydown="handleContentKeydown"
      >
        <slot></slot>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
  import { ref, watch, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'

  const props = defineProps({
    modelValue: {
      type: Boolean,
      default: false,
    },
    placement: {
      type: String,
      default: 'bottom',
      validator: (value) =>
        [
          'top',
          'bottom',
          'right',
          'left',
          'top-left',
          'top-right',
          'bottom-left',
          'bottom-right',
          'right-up',
          'right-down',
          'left-up',
          'left-down',
        ].includes(value),
    },
    closeOnClickOutside: {
      type: Boolean,
      default: true,
    },
    closeOnClick: {
      type: Boolean,
      default: false,
    },
    showCaret: {
      type: Boolean,
      default: true,
    },
    caretIcon: {
      type: String,
      default: '▼',
    },
    class: {
      type: String,
      default: '',
    },
  })

  const emit = defineEmits(['update:modelValue', 'open', 'close'])

  const isOpen = ref(props.modelValue)
  const buttonRef = ref(null)
  const contentRef = ref(null)
  const contentPosition = ref({})

  const className = computed(() => props.class)

  // Position content
  const updatePosition = () => {
    if (!buttonRef.value || !contentRef.value) return

    const buttonRect = buttonRef.value.getBoundingClientRect()
    const contentRect = contentRef.value.getBoundingClientRect()
    const gap = 8

    let top, left

    switch (props.placement) {
      case 'top':
        top = buttonRect.top - contentRect.height - gap
        left = buttonRect.left
        break
      case 'top-left':
        top = buttonRect.top - contentRect.height - gap
        left = buttonRect.right - contentRect.width
        break
      case 'top-right':
        top = buttonRect.top - contentRect.height - gap
        left = buttonRect.left
        break
      case 'bottom':
        top = buttonRect.bottom + gap
        left = buttonRect.left
        break
      case 'bottom-left':
        top = buttonRect.bottom + gap
        left = buttonRect.right - contentRect.width
        break
      case 'bottom-right':
        top = buttonRect.bottom + gap
        left = buttonRect.left
        break
      case 'right':
        top = buttonRect.top
        left = buttonRect.right + gap
        break
      case 'right-up':
        top = buttonRect.top
        left = buttonRect.right + gap
        break
      case 'right-down':
        top = buttonRect.bottom - contentRect.height
        left = buttonRect.right + gap
        break
      case 'left':
        top = buttonRect.top
        left = buttonRect.left - contentRect.width - gap
        break
      case 'left-up':
        top = buttonRect.top
        left = buttonRect.left - contentRect.width - gap
        break
      case 'left-down':
        top = buttonRect.bottom - contentRect.height
        left = buttonRect.left - contentRect.width - gap
        break
      default:
        top = buttonRect.bottom + gap
        left = buttonRect.left
    }

    contentPosition.value = {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
    }
  }

  const contentStyle = computed(() => contentPosition.value)

  // Sync with v-model
  watch(
    () => props.modelValue,
    (newVal) => {
      isOpen.value = newVal
    },
  )

  watch(isOpen, async (newVal) => {
    emit('update:modelValue', newVal)
    emit(newVal ? 'open' : 'close')

    // Update position after content renders
    if (newVal) {
      await nextTick()
      updatePosition()
    }
  })

  // Toggle
  const toggle = async () => {
    isOpen.value = !isOpen.value
    if (!isOpen.value) {
      await nextTick()
      updatePosition()
    }
  }

  // Close
  const close = () => {
    isOpen.value = false
  }

  // Click outside dropdown
  const handleClickOutside = (event) => {
    if (!props.closeOnClickOutside) return

    if (
      isOpen.value &&
      buttonRef.value &&
      !buttonRef.value.contains(event.target) &&
      contentRef.value &&
      !contentRef.value.contains(event.target)
    ) {
      close()
    }
  }

  // Keyboard navigation
  const handleKeydown = (event) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        event.preventDefault()
        if (!isOpen.value) {
          toggle()
        }
        break
      case 'Escape':
        if (isOpen.value) {
          close()
          buttonRef.value?.focus()
        }
        break
    }
  }

  const handleContentKeydown = (event) => {
    if (event.key === 'Escape') {
      close()
      buttonRef.value?.focus()
    }
  }

  // Click inside content (close on button/link click)
  const handleContentClick = (event) => {
    if (!props.closeOnClick) return

    const target = event.target.closest('button, a, [role="button"]')
    if (target) {
      // Close dropdown after click is handled
      setTimeout(() => close(), 0)
    }
  }

  // Update position on resize
  const handleResize = () => {
    if (isOpen.value) {
      updatePosition()
    }
  }

  // Lifecycle
  onMounted(() => {
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleContentKeydown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleContentKeydown)
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('scroll', handleResize, true)
  })
</script>
