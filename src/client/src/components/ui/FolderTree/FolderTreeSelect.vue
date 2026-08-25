<template>
  <div class="folder-tree-select" :class="{ 'folder-tree-select--open': isOpen }">
    <button
      ref="buttonRef"
      class="folder-tree-select__button"
      :class="{ 'folder-tree-select__button--open': isOpen }"
      @click="toggle"
      @keydown="handleKeydown"
      :aria-expanded="isOpen"
      :aria-haspopup="true"
    >
      <span v-if="selectedCount === 0" class="folder-tree-select__placeholder">
        {{ placeholder || $t('folderTree.selectPlaceholder') }}
      </span>
      <span v-else-if="selectedCount === 1" class="folder-tree-select__count">
        {{ selectedLabel }}
      </span>
      <span v-else class="folder-tree-select__count">{{
        $t('scan.foldersSelected', { count: selectedCount })
      }}</span>
      <span
        class="folder-tree-select__caret"
        :class="{ 'folder-tree-select__caret--rotated': isOpen }"
      >
        <span class="folder-tree-select__caret-icon"></span>
      </span>
    </button>

    <Teleport to="body">
      <div v-if="isOpen" ref="panelRef" class="folder-tree-select__panel" :style="panelStyle">
        <div class="folder-tree-select__panel-inner">
          <FolderTree
            :model-value="modelValue"
            :tree="tree"
            @update:model-value="$emit('update:modelValue', $event)"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
  import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { calculatePosition } from '@/composables/useVueSelectPosition'
  import FolderTree from './FolderTree.vue'

  const { t } = useI18n()

  const props = defineProps({
    modelValue: {
      type: Array,
      default: () => [],
    },
    tree: {
      type: Object,
      required: true,
    },
    placeholder: {
      type: String,
      default: '',
    },
  })

  defineEmits(['update:modelValue'])

  const isOpen = ref(false)
  const buttonRef = ref(null)
  const panelRef = ref(null)
  const panelStyle = ref({})

  const selectedCount = computed(() => props.modelValue.length)

  const selectedLabel = computed(() => {
    if (selectedCount.value !== 1) return ''
    const path = props.modelValue[0]
    if (path === '') return t('common.all')
    return path
  })

  function toggle() {
    isOpen.value = !isOpen.value
  }

  function close() {
    isOpen.value = false
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      close()
      return
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      isOpen.value = !isOpen.value
    }
  }

  function handleClickOutside(event) {
    if (!isOpen.value) return
    const target = event.target
    const select = target.closest('.folder-tree-select')
    const panel = target.closest('.folder-tree-select__panel')
    if (!select && !panel) {
      close()
    }
  }

  function updatePanelPosition() {
    if (!isOpen.value || !buttonRef.value || !panelRef.value) return
    calculatePosition(panelRef.value, buttonRef.value, {
      width: buttonRef.value.getBoundingClientRect().width,
    })
  }

  watch(isOpen, async (newVal) => {
    if (newVal) {
      await nextTick()
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      updatePanelPosition()
    }
  })

  function handleResize() {
    updatePanelPosition()
  }

  function handleScroll() {
    updatePanelPosition()
  }

  onMounted(() => {
    document.addEventListener('click', handleClickOutside, true)
    document.addEventListener('keydown', handleKeydown, true)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside, true)
    document.removeEventListener('keydown', handleKeydown, true)
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('scroll', handleScroll, true)
  })
</script>


