<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu"
      :style="{ top: y + 'px', left: x + 'px' }"
      @click.stop
    >
      <div class="context-menu-item" @click="$emit('rename')">
        <span class="icon">✏️</span>
        <span>{{ $t('tag.rename') }}</span>
      </div>
      <div
        v-if="tagType === 'places'"
        class="context-menu-item hide-sm"
        @click="$emit('setCoordinates')"
      >
        <span class="icon">📍</span>
        <span>{{ $t('tag.setCoordinates') }}</span>
      </div>
      <div class="context-menu-item delete" @click="$emit('delete')">
        <span class="icon">🗑️</span>
        <span>{{ $t('tag.delete') }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
  import { ref, onMounted, onUnmounted } from 'vue'

  const props = defineProps({
    visible: {
      type: Boolean,
      default: false,
    },
    x: {
      type: Number,
      default: 0,
    },
    y: {
      type: Number,
      default: 0,
    },
    tagType: {
      type: String,
      default: '',
    },
  })

  const emit = defineEmits(['rename', 'delete', 'close', 'setCoordinates'])

  const menuRef = ref(null)

  // Close on click outside menu
  const handleClickOutside = (e) => {
    if (props.visible && menuRef.value && !menuRef.value.contains(e.target)) {
      emit('close')
    }
  }

  // Close on Esc
  const handleEsc = (e) => {
    if (props.visible && e.key === 'Escape') {
      emit('close')
    }
  }

  // Register listeners on mount
  onMounted(() => {
    document.addEventListener('click', handleClickOutside, true)
    document.addEventListener('keydown', handleEsc)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside, true)
    document.removeEventListener('keydown', handleEsc)
  })
</script>
