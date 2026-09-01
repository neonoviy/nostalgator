<template>
  <div class="app">
    <div class="layout">
      <!-- Main content -->
      <main class="main-content">
        <!-- EXIF Sidebar (global for all galleries) -->
        <div id="exif-sidebar-container" class="d-none">
          <EXIFPanel :key="sidebarKey" :src="exifSidebarSrc" :media-id="currentMediaId" />
        </div>
        <div :class="['map-section', showMap ? 'is-open' : 'is-closed']">
          <Map ref="mapRef" @polygon-saved="onPolygonSaved" />
        </div>
        <div class="map-toggle-wrapper">
          <AppButton class="map-toggle" variant="secondary" size="sm" @click="toggleMap">
            <span class="map-toggle__icon">{{ showMap ? $t('map.hide') : $t('map.show') }}</span>
          </AppButton>
        </div>
        <div class="scroll-to-top-wrapper">
          <AppButton
            class="scroll-to-top"
            :class="{ 'scroll-to-top--visible': showScrollTop }"
            variant="secondary"
            size="sm"
            v-tooltip="$t('common.home')"
            @click="scrollToTop"
          >
            <span class="scroll-to-top__icon">{{ $t('common.backToTop') }}</span>
          </AppButton>
        </div>
        <div v-if="initialLoading" class="loading-initial">
          {{ $t('app.loading') }}
        </div>

        <!-- Timeline with events -->
        <TimelineView v-else />
      </main>
      <!-- Filter sidebar -->
      <Sidebar />
    </div>

    <!-- Event editing (side overlay) -->
    <EventEditModal
      v-model="showEditModal"
      :event="editingEvent"
      :saving="saving"
      :save-reset-key="saveResetKey"
      @save="handleSaveEvent"
      @close="showEditModal = false"
      @delete="deleteEvent"
    />

    <!-- Notifications -->
    <NotificationList />

    <!-- Drag'n'Drop overlay -->
    <DropOverlay :is-dragging="isDragging" />

    <!-- Login modal (global) -->
    <Modal
      v-model="showLoginModal"
      :title="$t('sidebar.loginTitle')"
      size="small"
      :close-on-click-outside="false"
    >
      <LoginForm :first-launch="firstLaunchLoginHint" @login-success="showLoginModal = false" />
    </Modal>

    <Teleport v-if="showFaceOverlay && fancyboxContainer" :to="fancyboxContainer">
      <FaceOverlay
        :faces="overlayFaces"
        :media-id="overlayMediaId"
        @name-assigned="onFaceNameChanged"
        @name-removed="onFaceNameChanged"
      />
    </Teleport>
  </div>
</template>

<script setup>
  import {
    ref,
    onMounted,
    onBeforeUnmount,
    provide,
    watch,
    computed,
    onBeforeMount,
    nextTick,
  } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useStorage } from '@vueuse/core'
  import { useReadonly, loadReadonlyStatus } from './composables/useReadonly'
  import { useI18n } from 'vue-i18n'
  import Sidebar from './components/sidebar/Sidebar.vue'
  import Map from './components/map.vue'
  import TimelineView from './views/TimelineView.vue'
  import Modal from './components/ui/Modal.vue'
  import EventEditModal from './components/events/EventEditModal.vue'
  import EXIFPanel from './components/lightbox/EXIFPanel.vue'
  import FaceOverlay from './components/lightbox/FaceOverlay.vue'
  import NotificationList from './components/ui/NotificationList.vue'
  import DropOverlay from './components/ui/DropOverlay.vue'
  import AppButton from './components/ui/AppButton.vue'
  import { useEvents } from './composables/useEvents'
  import LoginForm from './components/users/LoginForm.vue'
  import { useScan } from './composables/useScan'
  import { useSettingsModal } from './composables/useSettingsModal'
  import { useAuth } from './composables/useAuth'
  import { useDragDrop } from './composables/useDragDrop'
  import { useEventSave } from './composables/useEventSave'
  import { addNotification } from './composables/useNotifications.js'
  import { useClusters } from './composables/useClusters.js'
  import { usePlaces } from './composables/usePlaces.js'
  import { useWebSocket } from './composables/useWebSocket'
  import { isHistoryNavigation } from './composables/useFancyboxHistory'
  import { Fancybox } from '@fancyapps/ui'
  import { Sidebar as FancyboxSidebar } from '@fancyapps/ui/dist/fancybox/fancybox.sidebar.js'
  import '@fancyapps/ui/dist/fancybox/fancybox.sidebar.css'

  const { t } = useI18n()

  const MAP_COOKIE = 'map_visible'

  function getCookie(name) {
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) {
      return parts.pop().split(';').shift()
    }
    return null
  }

  function setCookie(name, value) {
    const maxAge = 31536000
    document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
  }

  const showMap = ref(getCookie(MAP_COOKIE) === 'true')

  watch(showMap, (newVal) => {
    setCookie(MAP_COOKIE, newVal ? 'true' : 'false')
  })

  function toggleMap() {
    showMap.value = !showMap.value
  }

  // Composables — passing token and user for API requests
  const authState = useAuth()
  const ws = useWebSocket()
  const { token, user } = authState

  // canUpload comes from server (validateToken) — admin, user with canUpload or in group with canUpload
  const isUploader = computed(() => user.value?.canUpload || false)

  const eventsState = useEvents(token, user)

  const {
    eventsByYear,
    visibleYears,
    loading,
    hasMore,
    totalEventsCount,
    dbHasEvents,
    checkDbHasEvents,
    loadEvents,
    updateKey,
    updateEventInState,
  } = eventsState

  const scanState = useScan(authState.isAdmin)
  const settingsModal = useSettingsModal()

  // Clusters
  const clustersState = useClusters(token)

  // Full places for hover (polygon + coords)
  const placesFullState = usePlaces(token)
  const fullPlaces = computed(() => placesFullState.places.value)

  // EXIF Sidebar state
  const exifSidebarSrc = ref('')
  const currentMediaId = ref(null)
  const overlayFaces = ref([])
  const overlayMediaId = ref(null)
  const fancyboxContainer = ref(null)
  const showFaceOverlay = ref(false)
  const sidebarKey = ref(0)

  const scrollToTop = () => {
    const mainContent = document.querySelector('.main-content')
    if (mainContent) {
      mainContent.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const suppressScrollWatch = ref(false)
  const isProgrammaticScroll = ref(false)
  const showScrollTop = ref(false)

  const pendingNotificationShown = useStorage('pending-notification-shown', false, window.sessionStorage)

  // Ref for accessing map methods
  const mapRef = ref(null)

  // Function to start polygon drawing mode
  const startPolygonDrawing = async (placeId) => {
    const mapWasHidden = !showMap.value
    if (mapWasHidden) {
      showMap.value = true
    }

    if (mapWasHidden) {
      await nextTick()
      await new Promise((resolve) => setTimeout(resolve, 450))
      const mapSection = document.querySelector('.map-section')
      if (mapSection) {
        await scrollMainContentTo(mapSection, 'smooth')
      }
    }

    if (mapRef.value && mapRef.value.startPolygonDrawing) {
      mapRef.value.startPolygonDrawing(placeId)
    }
  }

  // Provide EXIF Sidebar state for EventCard
  provide('exifSidebar', {
    setSrc: (src, mediaId) => {
      exifSidebarSrc.value = src
      currentMediaId.value = mediaId
      sidebarKey.value++
    },
    setOverlayFaces: (faces) => {
      overlayFaces.value = faces
    },
    setOverlayMediaId: (mediaId) => {
      overlayMediaId.value = mediaId
    },
    showFaceOverlay: (v) => {
      showFaceOverlay.value = v
    },
    openFancybox: () => {
      openFancybox()
    },
    closeFancybox: () => {
      closeFancybox()
    },
    reloadClusters: () => {
      mapRef.value?.reloadClusters?.()
    },
  })

  // Shake class for modal
  const modalShakeClass = ref('')

  // Trigger modal shake
  const triggerModalShake = () => {
    modalShakeClass.value = 'shake'
    setTimeout(() => {
      modalShakeClass.value = ''
    }, 500)
  }

  const openFancybox = () => {
    const container = document.querySelector('.fancybox__viewport')
    if (container) {
      fancyboxContainer.value = container
    }
    if (mapRef.value && mapRef.value.markExternalUrlChange) {
      mapRef.value.markExternalUrlChange()
    }
  }

  const closeFancybox = () => {
    fancyboxContainer.value = null
    if (mapRef.value && mapRef.value.markExternalUrlChange) {
      mapRef.value.markExternalUrlChange()
    }
  }

  const refreshOverlay = async () => {
    if (!overlayMediaId.value) return
    try {
      const res = await fetch(`/api/media/${overlayMediaId.value}/faces`)
      if (!res.ok) return
      const data = await res.json()
      overlayFaces.value = data.success ? data.data : data
    } catch (e) {
      console.error('Failed to refresh overlay:', e)
    }
  }

  const onSlideChanged = () => {
    overlayFaces.value = []
    overlayMediaId.value = null
    refreshOverlay()
    if (mapRef.value && mapRef.value.markExternalUrlChange) {
      mapRef.value.markExternalUrlChange()
    }
  }

  const onFaceNameChanged = (payload) => {
    if (!payload) return
    if (payload.participantName && Array.isArray(payload.eventIds)) {
      payload.eventIds.forEach((eventId) => {
        eventsState.updateEventParticipants(eventId, payload.participantName, 'add')
      })
    }
    if (payload.removedParticipantName && Array.isArray(payload.eventIds)) {
      payload.eventIds.forEach((eventId) => {
        eventsState.updateEventParticipants(eventId, payload.removedParticipantName, 'remove')
      })
    }
    eventsState.loadTagCounts()
  }

  const isSidebarVisible = (el) => {
    const container = document.querySelector('.fancybox__container')
    if (!container || !container.classList.contains('has-sidebar')) {
      return false
    }
    if (!el) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none') return false
    if (style.visibility === 'hidden') return false
    if (style.opacity === '0') return false
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return false
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    if (
      rect.right < 0 ||
      rect.left > window.innerWidth ||
      rect.bottom < 0 ||
      rect.top > window.innerHeight
    )
      return false
    return true
  }

  let overlayTimeout = null
  let overlayInterval = null
  let consecutiveVisible = 0
  let panzoomBlockHandler = null

  const disablePanzoom = () => {
    const container = document.querySelector('.fancybox__container')
    if (container) {
      container.classList.add('fancybox--no-panzoom')
    }
    panzoomBlockHandler = (e) => {
      if (e.type === 'wheel') {
        const sidebar = document.querySelector('.fancybox__sidebar')
        if (sidebar && sidebar.contains(e.target)) return
        const dropdown = e.target.closest('.vs__dropdown-menu')
        if (dropdown) return
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const fancyboxContainerEl = document.querySelector('.fancybox__container')
    if (fancyboxContainerEl) {
      fancyboxContainerEl.addEventListener('wheel', panzoomBlockHandler, {
        passive: false,
        capture: true,
      })
    }
  }

  const enablePanzoom = () => {
    const container = document.querySelector('.fancybox__container')
    if (container) {
      container.classList.remove('fancybox--no-panzoom')
    }
    if (panzoomBlockHandler) {
      const fancyboxContainerEl = document.querySelector('.fancybox__container')
      if (fancyboxContainerEl) {
        fancyboxContainerEl.removeEventListener('wheel', panzoomBlockHandler, true)
      }
      panzoomBlockHandler = null
    }
  }

  const startOverlayWatch = () => {
    if (overlayInterval) return
    consecutiveVisible = 0
    overlayTimeout = setTimeout(() => {
      overlayInterval = setInterval(() => {
        const sidebar = document.querySelector('.fancybox__sidebar')
        const isVisible = isSidebarVisible(sidebar)
        if (isVisible) {
          consecutiveVisible++
          if (consecutiveVisible >= 5) {
            disablePanzoom()
            showFaceOverlay.value = true
          }
        } else {
          consecutiveVisible = 0
          enablePanzoom()
          showFaceOverlay.value = false
        }
      }, 100)
    }, 500)
  }

  const stopOverlayWatch = () => {
    enablePanzoom()
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
      overlayTimeout = null
    }
    if (overlayInterval) {
      clearInterval(overlayInterval)
      overlayInterval = null
    }
    consecutiveVisible = 0
    showFaceOverlay.value = false
  }

  watch(showFaceOverlay, (v) => {
    if (v) refreshOverlay()
  })

  watch(overlayMediaId, () => {
    if (showFaceOverlay.value) refreshOverlay()
  })

  const route = useRoute()
  const router = useRouter()

  const scrollMainContentTo = (targetEl, behavior = 'auto') => {
    const mainContent = document.querySelector('.main-content')
    if (!mainContent || !targetEl) return

    const stickyHeader = document.querySelector('.year-header')
    const headerHeight = stickyHeader ? stickyHeader.offsetHeight : 0
    const targetRect = targetEl.getBoundingClientRect()
    const containerRect = mainContent.getBoundingClientRect()
    const offsetTop = targetRect.top - containerRect.top + mainContent.scrollTop - headerHeight

    return new Promise((resolve) => {
      isProgrammaticScroll.value = true
      mainContent.scrollTo({
        top: Math.max(0, offsetTop),
        behavior,
      })
      const onScrollEnd = () => {
        mainContent.removeEventListener('scroll', onScrollEnd)
        isProgrammaticScroll.value = false
        resolve()
      }
      if (behavior === 'smooth') {
        mainContent.addEventListener('scroll', onScrollEnd)
        setTimeout(onScrollEnd, 500)
      } else {
        isProgrammaticScroll.value = false
        resolve()
      }
    })
  }

  const scrollToDeepLink = () => {
    const year = route.params.year
    const month = route.params.month
    if (!year && !month) return Promise.resolve()

    return new Promise((resolve) => {
      const tryFind = async (page = 0) => {
        if (month) {
          const eventEl = document.querySelector(`.event-card[data-event-folder="${month}"]`)
          if (eventEl) {
            await scrollMainContentTo(eventEl)
            resolve()
            return
          }
        }
        if (year && !month) {
          const yearBlock = document.querySelector(`[data-year="${year}"]`)
          if (yearBlock) {
            await scrollMainContentTo(yearBlock)
            resolve()
            return
          }
        }

        if (!hasMore.value) {
          await nextTick()
          if (month) {
            const eventEl = document.querySelector(`.event-card[data-event-folder="${month}"]`)
            if (eventEl) {
              const eventId = parseInt(eventEl.dataset.eventId)
              await scrollMainContentTo(eventEl)
              resolve()
              return
            }
          }
          if (year) {
            const yearBlock = document.querySelector(`[data-year="${year}"]`)
            if (yearBlock) {
              await scrollMainContentTo(yearBlock)
              resolve()
              return
            }
          }
          resolve()
          return
        }

        if (loading.value) {
          setTimeout(() => tryFind(page), 200)
          return
        }

        await loadEvents(true)
        await nextTick()
        tryFind(page + 1)
      }

      tryFind()
    })
  }

  const getScrollSpyPath = () => {
    const mainContent = document.querySelector('.main-content')
    if (!mainContent) return null

    const stickyHeader = document.querySelector('.year-header')
    const headerHeight = stickyHeader ? stickyHeader.offsetHeight : 0
    const scrollTop = mainContent.scrollTop
    const threshold = headerHeight + 10

    const allEls = document.querySelectorAll('[data-year], .event-card[data-event-folder]')

    let activeEl = null
    for (const el of allEls) {
      const rect = el.getBoundingClientRect()
      const containerRect = mainContent.getBoundingClientRect()
      const relativeTop = rect.top - containerRect.top + mainContent.scrollTop

      if (relativeTop <= scrollTop + threshold) {
        activeEl = el
      } else {
        break
      }
    }

    if (!activeEl) {
      const firstTimelineEl = document.querySelector('.year-block, .event-card')
      if (firstTimelineEl) {
        const rect = firstTimelineEl.getBoundingClientRect()
        const containerRect = mainContent.getBoundingClientRect()
        const firstRelativeTop = rect.top - containerRect.top + mainContent.scrollTop

        if (firstRelativeTop > headerHeight + 80) {
          return '/'
        }
      }

      if (scrollTop < headerHeight + 50) {
        const firstYear = document.querySelector('[data-year]')
        if (firstYear) return `/${firstYear.getAttribute('data-year')}/`
        return '/'
      }
      return null
    }

    if (activeEl.matches('.event-card')) {
      const month = activeEl.getAttribute('data-event-folder')
      const yearBlock = activeEl.closest('[data-year]')
      const year = yearBlock ? yearBlock.getAttribute('data-year') : null
      if (year && month) return `/${year}/${month}/`
    }

    if (activeEl.matches('[data-year]')) {
      return `/${activeEl.getAttribute('data-year')}/`
    }

    return null
  }

  let scrollSpyDebounce = null
  const handleScrollSpy = async () => {
    if (scrollSpyDebounce) clearTimeout(scrollSpyDebounce)
    scrollSpyDebounce = setTimeout(() => {
      window.requestAnimationFrame(async () => {
        if (route.params.filename) return
        if (initialLoading.value) return
        if (document.querySelector('.fancybox__container')) return
        if (isProgrammaticScroll.value) return

        const newPath = getScrollSpyPath()
        if (!newPath) return

        const currentPath = route.path
        if (currentPath !== newPath) {
          suppressScrollWatch.value = true
          try {
            await router.replace({ path: newPath, query: route.query })
          } catch (e) {
            // ignore navigation aborted
          } finally {
            suppressScrollWatch.value = false
          }
        }
      })
    }, 30)
  }

  let scrollRaf = null
  const onMainContentScroll = () => {
    if (scrollRaf) return
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = null
      const mainContent = document.querySelector('.main-content')
      if (!mainContent) return
      showScrollTop.value = mainContent.scrollTop > mainContent.clientHeight * 0.55
    })
  }

  const handleHomeKey = (e) => {
    if (e.key === 'Home' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      e.preventDefault()
      scrollToTop()
    }
  }

  const openMediaByPath = (year, month, filename) => {
    const tryOpen = (attempts = 0) => {
      if (document.querySelector('.fancybox__container')) {
        return
      }
      const folderPath = `${year}/${month}`
      const trigger = document.querySelector(
        `a[data-folder-path="${folderPath}"][data-filename="${filename}"]`,
      )
      if (trigger) {
        const parent = trigger.closest('.event-thumbnails')
        if (!parent) return
        const thumbs = parent.querySelectorAll('.thumbnail')
        const slides = []
        thumbs.forEach((el) => {
          const a = el.querySelector('a[data-media-id]')
          if (!a) return
          const src = a.getAttribute('href')
          const id = a.dataset.mediaId
          const filename = a.dataset.filename
          if (src && id) {
            slides.push({
              src: src.replace(/^\/+/, '/originals/'),
              mediaId: parseInt(id),
              filename,
            })
          }
        })
        const startIndex = Array.from(thumbs).indexOf(trigger.closest('.thumbnail'))
        if (slides.length > 0 && startIndex >= 0) {
          try {
            Fancybox.close()
            Fancybox.show(slides, {
              plugins: { Sidebar: FancyboxSidebar },
              Hash: false,
              Sidebar: { showOnStart: false, defaultCaption: '' },
              caption: () => '',
              Info: false,
              Carousel: {
                Thumbs: { showOnStart: false },
                Toolbar: {
                  display: {
                    left: [],
                    middle: [],
                    right: ['autoplay', 'thumbs', 'sidebar', 'fullscreen', 'close'],
                  },
                },
              },
              startIndex,
              on: {
                ready: (fancybox) => {
                  const slide = fancybox.getSlide()
                  if (slide?.src) {
                    const mId = slide?.triggerEl?.dataset?.mediaId
                      ? parseInt(slide.triggerEl.dataset.mediaId)
                      : slide?.mediaId
                        ? parseInt(slide.mediaId)
                        : null
                    exifSidebarSrc.value = slide.src
                    currentMediaId.value = mId
                    sidebarKey.value++
                  }
                  window.dispatchEvent(new CustomEvent('fancybox:opened'))
                },
                'Carousel.contentReady': (fancybox, carousel, slide) => {
                  if (!slide || fancybox.getSlide() !== slide) return
                  const mId = slide?.triggerEl?.dataset?.mediaId
                    ? parseInt(slide.triggerEl.dataset.mediaId)
                    : slide?.mediaId
                      ? parseInt(slide.mediaId)
                      : null
                  exifSidebarSrc.value = slide.src
                  currentMediaId.value = mId
                  sidebarKey.value++
                  window.dispatchEvent(new CustomEvent('fancybox:opened'))
                },
                'Carousel.change': (fancybox) => {
                  const slide = fancybox.getSlide()
                  if (slide?.src) {
                    const mId = slide?.triggerEl?.dataset?.mediaId
                      ? parseInt(slide.triggerEl.dataset.mediaId)
                      : slide?.mediaId
                        ? parseInt(slide.mediaId)
                        : null
                    exifSidebarSrc.value = slide.src
                    currentMediaId.value = mId
                    sidebarKey.value++
                    const filename = slide?.filename
                    if (filename && route.params.year && route.params.month) {
                      const path = `/${route.params.year}/${route.params.month}/${filename}`
                      if (isHistoryNavigation.value) {
                        isHistoryNavigation.value = false
                        router.replace({ path, query: route.query })
                      } else {
                        router.push({ path, query: route.query })
                      }
                    }
                    window.dispatchEvent(new CustomEvent('fancybox:slideChanged'))
                  }
                },
                'Carousel.done': (fancybox) => {
                  const slide = fancybox.getSlide()
                  if (slide?.src) {
                    const mId = slide?.triggerEl?.dataset?.mediaId
                      ? parseInt(slide.triggerEl.dataset.mediaId)
                      : slide?.mediaId
                        ? parseInt(slide.mediaId)
                        : null
                    exifSidebarSrc.value = slide.src
                    currentMediaId.value = mId
                    sidebarKey.value++
                  }
                },
                close: () => {
                  const year = route.params.year
                  const month = route.params.month
                  const basePath = year && month ? `/${year}/${month}/` : '/'
                  router.replace({ path: basePath, query: route.query })
                  window.dispatchEvent(new CustomEvent('fancybox:closed'))
                },
              },
            })
          } catch (e) {
            console.error('[FANCYBOX] error:', e)
          }
        } else if (attempts < 20) {
          setTimeout(() => tryOpen(attempts + 1), 200)
        }
      } else if (attempts < 20) {
        setTimeout(() => tryOpen(attempts + 1), 200)
      } else {
        console.warn('[FANCYBOX] max attempts reached')
      }
    }
    tryOpen()
  }

  watch(
    () => [route.params.year, route.params.month, route.params.filename],
    async () => {
      if (suppressScrollWatch.value) return

      const { year, month, filename } = route.params
      if (!filename) return

      if (document.querySelector('.fancybox__container')) return
      await scrollToDeepLink()

      const folderPath = `${year}/${month}`
      const triggerSelector = `a[data-folder-path="${folderPath}"][data-filename="${filename}"]`

      await new Promise((r) => setTimeout(r, 150))

      for (let i = 0; i < 60; i++) {
        const trigger = document.querySelector(triggerSelector)
        if (trigger) {
          openMediaByPath(year, month, filename)
          return
        }
        await new Promise((r) => setTimeout(r, 200))
      }

      console.warn('Thumbnail not found for deep link:', triggerSelector)
    },
    { immediate: true },
  )

  const handleFancyboxPopState = async () => {
    const fancybox = Fancybox.getInstance()
    if (!fancybox || !document.querySelector('.fancybox__container')) return

    const pathParts = window.location.pathname.split('/').filter(Boolean)
    const filename = pathParts[2] ? decodeURIComponent(pathParts[2]) : null

    if (!filename) {
      Fancybox.close()
      return
    }

    const carousel = fancybox.Carousel || fancybox.carousel
    if (carousel?.slides?.length) {
      const index = Array.from(carousel.slides).findIndex((s) => s.filename === filename)
      if (index >= 0) {
        isHistoryNavigation.value = true
        carousel.slideTo(index)
        return
      }
    }

    Fancybox.close()
  }

  onMounted(() => {
    window.addEventListener('fancybox:opened', openFancybox)
    window.addEventListener('fancybox:closed', closeFancybox)
    window.addEventListener('fancybox:slideChanged', onSlideChanged)
    window.addEventListener('fancybox:opened', startOverlayWatch)
    window.addEventListener('fancybox:closed', stopOverlayWatch)
    window.addEventListener('media-deleted', () => loadEvents(false))
    window.addEventListener('ws:events-changed', onEventsChanged)
    window.addEventListener('ws:face-participants-changed', onWsFaceParticipantsChanged)

    window.addEventListener('ws:scan:pending-folders', onPendingFoldersEvent)

    window.addEventListener('keydown', handleHomeKey)

    const mainContent = document.querySelector('.main-content')
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScrollSpy)
      mainContent.addEventListener('scroll', onMainContentScroll)
    }

    window.addEventListener('popstate', handleFancyboxPopState)
  })

  // Destructuring reactive values (directly from useEvents)
  const { places, eventTypes, people, tags } = eventsState
  const {
    selectedYears,
    selectedPlaces,
    selectedEventTypes,
    selectedParticipants,
    selectedTags,
    selectedClusters,
  } = eventsState

  watch(
    [
      selectedYears,
      selectedPlaces,
      selectedEventTypes,
      selectedParticipants,
      selectedTags,
      selectedClusters,
    ],
    () => {
      if (!initialLoading.value) {
        scrollToTop()
      }
    },
  )

  // State
  const initialLoading = ref(true)
  const showEditModal = ref(false)
  const editingEvent = ref(null)
  const hoveredPlace = ref(null)
  const showLoginModal = ref(false)
  const firstLaunchFlowDone = ref(false)
  const firstLaunchLoginHint = ref(false)
  const saveResetKey = ref(0)
  const lastSavedEventId = ref(null)

  // Composable for saving events
  const {
    saveEvent: saveEventTags,
    deleteEvent: deleteEventFromApp,
    saving,
  } = useEventSave(token, eventsByYear, eventsState, showEditModal, loadEvents)

  // Wrapper for deleteEvent
  const deleteEvent = async (data) => {
    await deleteEventFromApp(data)
  }

  const handleSaveEvent = async (data) => {
    lastSavedEventId.value = data.id
    setTimeout(() => {
      if (lastSavedEventId.value === data.id) {
        lastSavedEventId.value = null
      }
    }, 5000)
    const ok = await saveEventTags(data)
    if (ok) saveResetKey.value++
  }

  // ============================================
  // Methods
  // ============================================

  const openEditModal = (event) => {
    editingEvent.value = event
    showEditModal.value = true
  }

  // Reset editing event when overlay closes
  watch(showEditModal, (val) => {
    if (!val) editingEvent.value = null
  })

  const onPolygonSaved = () => {
    eventsState.loadTagCounts()
    placesFullState.loadPlaces()
  }

  // ============================================
  // Theme (light/dark/auto)
  // ============================================

  // Saved theme in localStorage (reactive)
  const storedPreferredTheme = useStorage('theme', 'auto', localStorage)

  // Reactive value for current system theme
  const systemTheme = ref(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )

  // Computed actual theme
  const actualTheme = computed(() => {
    if (storedPreferredTheme.value === 'auto') {
      return systemTheme.value
    }
    return storedPreferredTheme.value
  })

  // Apply theme to body on change
  watch(
    actualTheme,
    (theme) => {
      document.body.setAttribute('data-theme', theme)
    },
    { immediate: true },
  )

  // System theme change listener
  const systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemThemeMediaQuery.addEventListener('change', (e) => {
    systemTheme.value = e.matches ? 'dark' : 'light'
  })

  // Theme set function (called from DarkmodeMenu)
  const setTheme = (theme) => {
    storedPreferredTheme.value = theme
  }

  // Provide for child components (wrapped in computed for reactivity)
  provide('themeContext', {
    storedPreferredTheme: computed(() => storedPreferredTheme.value),
    actualTheme,
    setTheme,
  })

  // Provide context for child components
  provide('timelineContext', {
    eventsByYear,
    visibleYears,
    loading,
    hasMore,
    totalEventsCount,
    dbHasEvents,
    loadEvents,
    openEditModal,
    updateKey,
    editingEvent,
  })

  // Provide filter data for FilterPanel (via computed for reactivity)
  const filterContext = {
    years: computed(() => eventsState.years.value),
    yearCounts: computed(() => eventsState.yearCounts.value),
    places: computed(() => eventsState.places.value),
    fullPlaces,
    eventTypes: computed(() => eventsState.eventTypes.value),
    people: computed(() => eventsState.people.value),
    tags: computed(() => eventsState.tags.value),
    tagCounts: computed(() => eventsState.tagCounts.value),
    selectedYears: computed(() => eventsState.selectedYears.value),
    selectedPlaces: computed(() => eventsState.selectedPlaces.value),
    selectedEventTypes: computed(() => eventsState.selectedEventTypes.value),
    selectedParticipants: computed(() => eventsState.selectedParticipants.value),
    selectedTags: computed(() => eventsState.selectedTags.value),
    selectedClusters: computed(() => eventsState.selectedClusters.value),
    clusters: computed(() => clustersState.clusters.value),
    hoveredPlace: computed({
      get: () => hoveredPlace.value,
      set: (v) => {
        hoveredPlace.value = v
      },
    }),
    toggleFilter: eventsState.toggleFilter,
    clearAllFilters: () => {
      eventsState.clearAllFilters()
      scrollToTop()
    },
    renameTag: eventsState.renameTag,
    deleteTag: eventsState.deleteTag,
    loadEvents: eventsState.loadEvents,
    loadTagCounts: eventsState.loadTagCounts,
    loadPlaces: placesFullState.loadPlaces,
    loadYears: eventsState.loadYears,
    startPolygonDrawing,
    setHoveredPlace: (place) => {
      hoveredPlace.value = place
    },
    clearHoveredPlace: () => {
      hoveredPlace.value = null
    },
  }

  provide('filterContext', filterContext)

  // Provide upload permissions for child components
  provide('uploaderContext', {
    isUploader,
  })

  // Provide scanning state for child components
  provide('scanContext', {
    ...scanState,
    firstLaunch: computed(
      () => !dbHasEvents.value && !firstLaunchFlowDone.value && totalEventsCount.value === 0,
    ),
    completeFirstLaunch: () => {
      firstLaunchFlowDone.value = true
    },
  })

  // Provide settings modal state for child components
  provide('settingsModalContext', settingsModal)

  // Provide authentication state for child components
  provide('authContext', {
    ...authState,
    openLoginModal: () => {
      showLoginModal.value = true
    },
  })

  // ============================================
  // WebSocket for event updates
  // ============================================

  const findEventInState = (eventId) => {
    for (const year in eventsByYear) {
      const found = eventsByYear[year].events.find((e) => Number(e.id) === Number(eventId))
      if (found) return found
    }
    return null
  }

  const onEventsChanged = async (e) => {
    const detail = (e && e.detail) || {}
    const eventId = detail.eventId

    if (eventId && Number(eventId) === Number(lastSavedEventId.value)) {
      lastSavedEventId.value = null
      eventsState.loadTagCounts()
      return
    }

    if (eventId) {
      const existingEvent = findEventInState(eventId)
      if (existingEvent) {
        try {
          const res = await fetch(`/api/events/${eventId}`, {
            headers: { Authorization: token.value ? `Bearer ${token.value}` : '' },
          })
          if (res.ok) {
            const data = await res.json()
            const updatedEvent = data.success ? data.data : data
            if (updatedEvent) {
              updateEventInState(updatedEvent)
              eventsState.loadTagCounts()
              return
            }
          }
        } catch (err) {
          console.error('Failed to fetch updated event:', err)
        }
      }
    }

    loadEvents(false)
    eventsState.loadTagCounts()
    clustersState.reload()
  }

  // Realtime update of event participant tags pushed from the server after a
  // face is named/unnamed (manual naming or scan). Mirrors the local
  // onFaceNameChanged handler but is driven by the WebSocket broadcast so the
  // timeline stays in sync even when the event isn't loaded in the store yet.
  const onWsFaceParticipantsChanged = (e) => {
    const { added = [], removed = [] } = (e && e.detail) || {}
    added.forEach(({ eventId, name }) => {
      if (eventId != null && name) eventsState.updateEventParticipants(eventId, name, 'add')
    })
    removed.forEach(({ eventId, name }) => {
      if (eventId != null && name) eventsState.updateEventParticipants(eventId, name, 'remove')
    })
    eventsState.loadTagCounts()
  }

  // Drag'n'Drop
  const {
    isDragging,
    setupListeners: setupDragDrop,
    cleanupListeners: cleanupDragDrop,
  } = useDragDrop(scanState, isUploader)

  // ============================================
  // Auto-refresh data on scan
  // ============================================

  // Set callback that fires when manual scan completes
  scanState.setScanCompletionHandler(async () => {
    await Promise.all([eventsState.loadTagCounts(), eventsState.loadYears()])
    await loadEvents(false)
  })

  // Notify admin about folders awaiting scan (new events detected on disk)
  const notifyPendingEvents = async () => {
    if (!authState.isAdmin.value) return
    if (pendingNotificationShown.value) return
    await scanState.loadPendingFolders()
    if (scanState.pendingFolders.value.length === 0) return
    pendingNotificationShown.value = true
    addNotification('info', t('app.newEventsDetected'), {
      id: 'pending-events',
      persistent: true,
      actionLabel: t('app.openScan'),
      actionHandler: () => {
        settingsModal.openSettingsModal('scan', {
          folders: [...scanState.pendingFolders.value],
        })
      },
    })
  }

  // Live update from server when pending folders change (watcher detects changes)
  const onPendingFoldersEvent = (event) => {
    const folders = (event.detail && event.detail.folders) || []
    scanState.pendingFolders.value = folders
  }


  // ============================================
  // Lifecycle
  // ============================================

  onMounted(async () => {
    setupDragDrop()

    window.addEventListener('keydown', handleHomeKey)

    // Wait for WS server:ready with fallback
    const waitForServerReady = () => {
      if (ws.isServerReady.value) return Promise.resolve()
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('ws:server-ready', onReady)
          console.warn('[App] ws:server-ready timeout, proceeding without WS')
          resolve()
        }, 10000)
        const onReady = () => {
          clearTimeout(timeout)
          resolve()
        }
        window.addEventListener('ws:server-ready', onReady, { once: true })
      })
    }

    await waitForServerReady()

    await loadReadonlyStatus()

    // Wait for authentication check completion (checkAuth in useAuth)
    if (authState.isLoading.value) {
      await new Promise((resolve) => {
        const stop = watch(
          () => !authState.isLoading.value,
          (ready) => {
            if (ready) {
              stop()
              resolve()
            }
          },
          { immediate: true },
        )
      })
    }

    try {
      // Sync filters from URL
      // syncFromUrl was already called via watch in useUrlFilters with immediate: true
      // Give time for URL → filters sync
      await nextTick()
      eventsState.syncSelectedFromUrlFilters()

      // Load tags and counts (years + tags)
      await eventsState.loadTagCounts()
      await eventsState.loadYears()
      await loadEvents(false)
      await placesFullState.loadPlaces()

      initialLoading.value = false

      if (route.params.year || route.params.month) {
        await scrollToDeepLink()
      }
    } catch (err) {
      console.error('Initialization error:', err)
      initialLoading.value = false
    }

    // First-launch flow: if DB is empty, show modals
    try {
      await checkDbHasEvents()
      if (!dbHasEvents.value) {
        if (!user.value) {
          showLoginModal.value = true
          firstLaunchLoginHint.value = true
        } else {
          settingsModal.openSettingsModal('scan')
        }
      } else if (authState.isAdmin.value) {
        // Existing library: notify admin about folders awaiting scan
        notifyPendingEvents()
      }
    } catch (e) {
      console.error('Failed to check DB events for first-launch flow:', e)
    }
  })

  // Reset first-launch hint when login modal closes
  watch(showLoginModal, (val) => {
    if (!val) firstLaunchLoginHint.value = false
  })

  // After successful login — notify admin about folders awaiting scan
  watch(
    () => user.value?.id,
    (newId, oldId) => {
      if (newId && !oldId && !dbHasEvents.value && !firstLaunchFlowDone.value) {
        settingsModal.openSettingsModal('scan')
      }
      if (newId && !oldId && dbHasEvents.value && authState.isAdmin.value) {
        notifyPendingEvents()
      }
    },
  )

  // Scan starts → first-launch onboarding is complete. The modal-close path must
  // NOT clear `firstLaunch`: dismissing the scan modal (without scanning) keeps the
  // DB empty, so reopening it (e.g. via LoadMoreTrigger's "start scan" link) must
  // still show the first-launch hint until a scan actually starts.
  watch(
    () => scanState.isScanning.value,
    (isScanning) => {
      if (isScanning && !firstLaunchFlowDone.value) {
        firstLaunchFlowDone.value = true
      }
    },
  )

  onBeforeUnmount(() => {
    cleanupDragDrop()
    stopOverlayWatch()
    window.removeEventListener('fancybox:opened', openFancybox)
    window.removeEventListener('fancybox:closed', closeFancybox)
    window.removeEventListener('fancybox:slideChanged', onSlideChanged)
    window.removeEventListener('fancybox:opened', startOverlayWatch)
    window.removeEventListener('fancybox:closed', stopOverlayWatch)
    window.removeEventListener('media-deleted', () => loadEvents(false))
    window.removeEventListener('ws:events-changed', onEventsChanged)
    window.removeEventListener('ws:face-participants-changed', onWsFaceParticipantsChanged)
    window.removeEventListener('ws:scan:pending-folders', onPendingFoldersEvent)
    window.removeEventListener('popstate', handleFancyboxPopState)
    window.removeEventListener('keydown', handleHomeKey)

    const mainContent = document.querySelector('.main-content')
    if (mainContent) {
      mainContent.removeEventListener('scroll', handleScrollSpy)
      mainContent.removeEventListener('scroll', onMainContentScroll)
    }
    if (scrollRaf) {
      window.cancelAnimationFrame(scrollRaf)
    }
  })
</script>
