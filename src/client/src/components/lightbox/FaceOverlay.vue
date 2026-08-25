<template>
  <div class="face-overlay" :style="overlayStyle()">
    <div class="face-wrapper" :style="wrapperStyle">
      <template v-for="face in visibleFaces" :key="face.id">
        <div
          class="face-rectangle"
          :class="faceClass(face)"
          :style="rectStyle(face)"
          @click="togglePopup(face, $event)"
        >
          <template v-if="face.personName && activePopupFaceId !== face.id">
            <span class="face-label named">{{ face.personName }}</span>
          </template>
          <span v-if="!face.personName && activePopupFaceId !== face.id" class="face-label unnamed"
            >?</span
          >
        </div>
      </template>
    </div>
  </div>

  <div
    v-if="activePopupFaceId !== null"
    ref="popupRef"
    class="face-popup"
    :style="popupStyle"
    @click.stop
  >
    <div class="face-popup__arrow" :class="popupArrowClass" />
    <div v-if="savingFaceId === activePopupFaceId" class="face-popup__spinner">
      <span class="spinner-icon">⏳</span>
      <span>{{ t('face.saving') }}</span>
    </div>
    <template v-else>
      <VueSelect
        class="face-popup__select"
        :model-value="activePopupFace?.personName || ''"
        :options="participantNames"
        :no-drop="!participantNames.length"
        :taggable="true"
        :create-option="createOption"
        :clearable="true"
        :auto-focus="true"
        :placeholder="t('face.unknown')"
        :search-placeholder="t('face.selectParticipant')"
         no-options-text="{{ t('face.noParticipants') }}"
        @update:model-value="onModelChange(activePopupFaceId, $event)"
        @search="onSearch"
      />
    </template>
  </div>
</template>

<script setup>
  import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useAuth } from '@/composables/useAuth'
  import { calculatePosition } from '@/composables/useVueSelectPosition'
  import VueSelect from 'vue-select'
  import 'vue-select/dist/vue-select.css'

  // NOTE: This component is teleported into `.fancybox__container` via App.vue (line 54):
  // <Teleport v-if="showFaceOverlay && fancyboxContainer" :to="fancyboxContainer">
  //   <FaceOverlay ... />
  // </Teleport>

  const { t } = useI18n()
  const auth = useAuth()
  const isAdmin = auth.isAdmin

  const props = defineProps({
    faces: { type: Array, default: () => [] },
    mediaId: { type: Number, default: null },
    imageWidth: { type: Number, default: 0 },
    imageHeight: { type: Number, default: 0 },
    imageRect: { type: Object, default: null },
  })

  const emit = defineEmits(['name-assigned', 'name-removed'])

  const participants = ref([])
  const facesLocal = ref([])
  const computedRect = ref(null)
  const lastValidMediaId = ref(null)
  const activePopupFaceId = ref(null)
  const savingFaceId = ref(null)
  const popupRef = ref(null)
  const popupAnchorEl = ref(null)
  let resizeObserver = null
  let mutationObserver = null
  let rafId = null
  let transitionHandler = null

  const participantNames = computed(() => participants.value.map((p) => p.name))

  const updateFaceName = (faceId, name) => {
    facesLocal.value = facesLocal.value.map((f) =>
      f.id === faceId ? { ...f, personName: name } : f,
    )
  }

  watch(
    () => props.faces,
    (newFaces) => {
      facesLocal.value = [...newFaces]
    },
    { immediate: true },
  )

  const visibleFaces = computed(() => {
    if (isAdmin.value) return facesLocal.value
    return facesLocal.value.filter((f) => f.personName)
  })

  const activePopupFace = computed(() => {
    if (activePopupFaceId.value === null) return null
    return facesLocal.value.find((f) => f.id === activePopupFaceId.value) || null
  })

  const createOption = (input) => ({ label: input, value: input })

  const fetchParticipants = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      const res = await fetch('/api/participants', {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      })
      if (res.ok) {
        const data = await res.json()
        const result = data.success ? data.data : data
        participants.value = result
      }
    } catch (e) {
      /* silent */
    }
  }

  const computeRect = () => {
    const container = document.querySelector('.fancybox__container')
    const viewport = container?.querySelector('.f-panzoom__viewport')
    const img = viewport?.querySelector('img')
    if (!container || !viewport || !img) {
      computedRect.value = null
      return
    }
    const viewportRect = viewport.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const naturalW =
      img.naturalWidth || parseInt(viewport.getAttribute('width')) || viewport.clientWidth || 1
    const naturalH =
      img.naturalHeight || parseInt(viewport.getAttribute('height')) || viewport.clientHeight || 1
    computedRect.value = {
      top: viewportRect.top - containerRect.top,
      left: viewportRect.left - containerRect.left,
      width: viewportRect.width,
      height: viewportRect.height,
      naturalWidth: naturalW,
      naturalHeight: naturalH,
    }
    lastValidMediaId.value = props.mediaId
  }

  const observeViewport = () => {
    if (!resizeObserver) return
    const viewport = document.querySelector('.f-panzoom__viewport')
    if (viewport) resizeObserver.observe(viewport)
    const grid = document.querySelector('.fancybox__grid')
    if (grid) resizeObserver.observe(grid)
  }

  const startRafLoop = () => {
    if (rafId) cancelAnimationFrame(rafId)
    let start = performance.now()
    const tick = () => {
      computeRect()
      if (performance.now() - start < 600) {
        rafId = requestAnimationFrame(tick)
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  watch(
    () => props.mediaId,
    () => {
      computedRect.value = null
      lastValidMediaId.value = null
      nextTick(() => computeRect())
    },
  )

  const onFancyboxOpened = () => {
    computeRect()
    observeViewport()
  }

  const onFancyboxClosed = () => {
    computedRect.value = null
    lastValidMediaId.value = null
    if (resizeObserver) resizeObserver.disconnect()
  }

  onMounted(() => {
    window.addEventListener('fancybox:opened', onFancyboxOpened)
    window.addEventListener('fancybox:slideChanged', startRafLoop)
    window.addEventListener('fancybox:closed', onFancyboxClosed)
    window.addEventListener('resize', computeRect)

    if (window.ResizeObserver) {
      resizeObserver = new window.ResizeObserver(() => computeRect())
      observeViewport()
    }

    if (window.MutationObserver) {
      mutationObserver = new MutationObserver(() => computeRect())
      const container = document.querySelector('.fancybox__container')
      if (container) {
        mutationObserver.observe(container, {
          attributes: true,
          attributeFilter: ['class'],
          childList: true,
          subtree: true,
        })
      }
    }

    const sidebar = document.querySelector('.fancybox__sidebar')
    if (sidebar) {
      transitionHandler = () => computeRect()
      sidebar.addEventListener('transitionend', transitionHandler)
    }

    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleKeyDown)

    fetchParticipants()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('fancybox:opened', onFancyboxOpened)
    window.removeEventListener('fancybox:slideChanged', startRafLoop)
    window.removeEventListener('fancybox:closed', onFancyboxClosed)
    window.removeEventListener('resize', computeRect)
    if (rafId) cancelAnimationFrame(rafId)
    if (resizeObserver) resizeObserver.disconnect()
    if (mutationObserver) mutationObserver.disconnect()
    const sidebar = document.querySelector('.fancybox__sidebar')
    if (sidebar && transitionHandler) {
      sidebar.removeEventListener('transitionend', transitionHandler)
    }
    document.removeEventListener('click', handleDocumentClick)
    document.removeEventListener('keydown', handleKeyDown)
  })

  const rect = computed(() => props.imageRect || computedRect.value)

  const overlayStyle = () => {
    if (rect.value) {
      return {
        top: rect.value.top + 'px',
        left: rect.value.left + 'px',
        width: rect.value.width + 'px',
        height: rect.value.height + 'px',
      }
    }
    return {
      inset: 0,
    }
  }

  const wrapperStyle = computed(() => {
    const r = rect.value
    if (!r || !r.width || !r.height) {
      return {
        width: '100px',
        height: '100px',
        top: '0px',
        left: '0px',
        border: '2px solid lime',
      }
    }
    const naturalW = r.naturalWidth || r.width || 1
    const naturalH = r.naturalHeight || r.height || 1
    const overlayW = r.width
    const overlayH = r.height
    const photoAspect = naturalW / naturalH
    const overlayAspect = overlayW / overlayH

    let width, height
    if (photoAspect > overlayAspect) {
      width = '100%'
      height = (overlayAspect / photoAspect) * 100 + '%'
    } else {
      height = '100%'
      width = (photoAspect / overlayAspect) * 100 + '%'
    }

    return {
      width,
      height,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  })

  const rectStyle = (face) => {
    const r = rect.value
    const iw = r?.naturalWidth || r?.width || 1
    const ih = r?.naturalHeight || r?.height || 1
    if (props.mediaId !== lastValidMediaId.value) {
      return { display: 'none' }
    }
    return {
      left: (face.x / iw) * 100 + '%',
      top: (face.y / ih) * 100 + '%',
      width: (face.w / iw) * 100 + '%',
      height: (face.h / ih) * 100 + '%',
    }
  }

  const faceClass = (face) => {
    return face.personName ? 'named' : 'unnamed'
  }

  const togglePopup = (face, event) => {
    if (!isAdmin.value) return
    if (event) {
      event.stopPropagation()
    }
    if (activePopupFaceId.value === face.id) {
      closePopup()
      return
    }
    popupAnchorEl.value = event?.target?.closest?.('.face-rectangle') || null
    activePopupFaceId.value = face.id
  }

  const closePopup = () => {
    activePopupFaceId.value = null
    popupAnchorEl.value = null
  }

  const handleDocumentClick = (event) => {
    if (activePopupFaceId.value === null) return
    if (popupRef.value && popupRef.value.contains(event.target)) return
    const target = event.target.closest('.face-rectangle')
    if (target) return
    closePopup()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && activePopupFaceId.value !== null) {
      closePopup()
    }
  }

  const popupStyle = computed(() => {
    if (activePopupFaceId.value === null || !popupAnchorEl.value) return {}

    const anchorRect = popupAnchorEl.value.getBoundingClientRect()
    const popupWidth = 220
    const popupHeight = 44
    const gap = 4
    const arrowSize = 6
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let top, left

    const spaceAbove = anchorRect.top
    const spaceBelow = viewportH - anchorRect.bottom

    if (spaceAbove >= popupHeight + gap + arrowSize || spaceAbove >= spaceBelow) {
      top = anchorRect.top - popupHeight - gap - arrowSize
    } else {
      top = anchorRect.bottom + gap + arrowSize
    }

    left = anchorRect.left + anchorRect.width / 2 - popupWidth / 2
    left = Math.max(8, Math.min(left, viewportW - popupWidth - 8))
    top = Math.max(8, Math.min(top, viewportH - popupHeight - 8))

    return {
      top: top + 'px',
      left: left + 'px',
      width: popupWidth + 'px',
    }
  })

  const popupArrowClass = computed(() => {
    if (activePopupFaceId.value === null || !popupAnchorEl.value) return ''

    const anchorRect = popupAnchorEl.value.getBoundingClientRect()
    const popupHeight = 44
    const gap = 4
    const arrowSize = 6
    const viewportH = window.innerHeight

    const spaceAbove = anchorRect.top
    const spaceBelow = viewportH - anchorRect.bottom

    if (spaceAbove >= popupHeight + gap + arrowSize || spaceAbove >= spaceBelow) {
      return 'face-popup__arrow--bottom'
    }
    return 'face-popup__arrow--top'
  })

  const onModelChange = async (faceId, value) => {
    if (value === null || value === undefined || value === '') {
      savingFaceId.value = faceId
      await unnameFace(faceId)
      savingFaceId.value = null
      closePopup()
      return
    }
    const name = typeof value === 'object' ? value?.label || value?.value || '' : String(value)
    if (!name || !name.trim()) return
    savingFaceId.value = faceId
    try {
      const token = localStorage.getItem('auth_token')
      const res = await fetch(`/api/media/${props.mediaId}/faces/${faceId}/name`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        const response = data.success ? data.data : data
        emit('name-assigned', { participantName: name.trim(), eventIds: response.eventIds || [] })
        updateFaceName(faceId, name.trim())
        await fetchParticipants()
      }
    } catch (e) {
      /* silent */
    }
    savingFaceId.value = null
    closePopup()
  }

  const onSearch = () => {}

  const unnameFace = async (faceId) => {
    try {
      const token = localStorage.getItem('auth_token')
      const res = await fetch(`/api/media/${props.mediaId}/faces/${faceId}/unname`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
      })
      if (res.ok) {
        const data = await res.json()
        const response = data.success ? data.data : data
        emit('name-removed', {
          eventIds: response.eventIds || [],
          removedParticipantId: response.removedParticipantId || null,
          participantDeleted: response.participantDeleted || false,
          removedParticipantName: response.removedParticipantName || null,
        })
        updateFaceName(faceId, null)
        await fetchParticipants()
      }
    } catch (e) {
      /* silent */
    }
  }
</script>

<style>
  .face-overlay {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    z-index: 15;
  }
  .face-wrapper {
    position: absolute;
  }
  .face-rectangle {
    position: absolute;
    border: 2px solid #ff00ff;
    pointer-events: auto;
    cursor: pointer;
  }
  .face-rectangle.named {
    border-color: #4caf50;
  }
  .face-label {
    position: absolute;
    top: -16px;
    left: 0;
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 2px;
    white-space: nowrap;
    color: white;
    background: #ff00ff;
  }
  .face-label.named {
    background: rgba(76, 175, 80, 0.85);
  }
  .face-popup {
    position: fixed;
    background: var(--bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: var(--spacing-sm);
    z-index: 9999;
    pointer-events: auto;
  }
  .face-popup__arrow {
    position: absolute;
    width: 0;
    height: 0;
    border: 6px solid transparent;
  }
  .face-popup__arrow--bottom {
    bottom: -12px;
    left: 50%;
    transform: translateX(-50%);
    border-top-color: var(--border-color);
    border-bottom: none;
  }
  .face-popup__arrow--top {
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    border-bottom-color: var(--border-color);
    border-top: none;
  }
  .face-popup__select {
    width: 180px;
  }
  .face-popup__spinner {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) 0;
    color: var(--primary);
    font-size: var(--font-size-sm);
  }
  .spinner-icon {
    font-size: var(--font-size-xl);
  }

  .fancybox--no-panzoom .f-panzoom__viewport,
  .fancybox--no-panzoom .f-panzoom__wrapper,
  .fancybox--no-panzoom .f-panzoom {
    pointer-events: none;
    touch-action: none;
  }
  /* 
.is-horizontal.is-ltr .f-button.is-arrow.is-next {
  inset: auto 0 0 auto;
}
.is-horizontal.is-ltr .f-button.is-arrow.is-prev{
   inset: auto auto 0 auto;
}

.f-button.is-arrow{
    transform: none !important;
    border-radius: 0;
    height: 92px;
    background: var(--f-button-bg);
}

.fancybox__carousel:has(.fancybox__thumbs.is-hidden) .f-button.is-arrow{
  height: 46px;
  background: transparent;
}

.fancybox__carousel:has(.fancybox__thumbs.is-hidden) .f-button.is-arrow:hover{
  background: transparent;
} */
</style>
