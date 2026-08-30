<template>
  <div class="event-thumbnails">
    <!-- Thumbnails -->
    <div
      v-for="(thumb, index) in displayedThumbnails"
      :key="thumb.id || index"
      class="thumbnail"
      :class="{
        'd-none': shouldHideThumbnail(index),
        'is-video': isVideoFile(thumb.filename),
        'opacity-50': shouldDimThumbnail(thumb.clusterId) || shouldDimByParticipant(thumb),
      }"
    >
      <a
        :href="getSpaUrl(thumb)"
        :data-media-id="thumb.id"
        :data-folder-path="props.folderPath"
        :data-filename="thumb.filename"
        @click.prevent="openThumbnail(thumb, index)"
      >
        <img :src="thumb.url" :alt="thumb.filename" loading="lazy" @error="handleImageError" />
        <div v-if="isVideoFile(thumb.filename)" class="video-icon">▶</div>
      </a>
    </div>

    <!-- "+N" button in place of 101st thumbnail -->
    <div v-if="shouldShowPlusButton" class="thumbnail show-more-btn-container">
      <button class="app-button show-more-btn" @click="showAllThumbnails = true">
        +{{ hiddenCount }}
      </button>
    </div>

    <!-- Skeletons for not yet generated thumbnails -->
    <div
      v-for="i in skeletonsCount"
      :key="`skeleton-${i}`"
      class="thumbnail thumbnail-skeleton"
      :class="{ 'd-none': shouldHideSkeleton(i) }"
    />

    <!-- Loading indicator -->
    <div v-if="loadingThumbnails" class="loading-thumbnails">
      {{ $t('thumbnails.loading') }}
    </div>
  </div>
</template>

<script setup>
  import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useI18n } from 'vue-i18n'
  import { THUMBNAILS_PER_EVENT, VIDEO_EXTENSIONS } from '../../config.js'
  import { Fancybox } from '@fancyapps/ui'
  import { Sidebar } from '@fancyapps/ui/dist/fancybox/fancybox.sidebar.js'
  import { isHistoryNavigation } from '../../composables/useFancyboxHistory'
  import '@fancyapps/ui/dist/fancybox/fancybox.css'
  import '@fancyapps/ui/dist/fancybox/fancybox.sidebar.css'

  const props = defineProps({
    eventId: { type: Number, required: true },
    mediaCount: { type: Number, default: 0 },
    folderPath: { type: String, required: true },
    selectedClusters: { type: Array, default: () => [] },
    selectedParticipants: { type: Array, default: () => [] },
  })

  const emit = defineEmits(['loaded'])

  const displayedThumbnails = ref([])
  const loadingThumbnails = ref(false)
  const showAllThumbnails = ref(false)

  const exifSidebar = inject('exifSidebar')
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()

  const getOriginalUrl = (thumb) => {
    let filename = thumb.filename
    const isVideoThumbnail = VIDEO_EXTENSIONS.some((ext) => filename.includes(`${ext}.`))
    if (filename.endsWith('.jpg') && isVideoThumbnail) {
      filename = filename.replace(/\.jpg$/, '')
    }
    return `/originals/${props.folderPath}/${filename}`
  }

  const getSpaUrl = (thumb) => {
    return `/${props.folderPath}/${thumb.filename}`
  }

  const getFancyboxOptions = () => ({
    plugins: { Sidebar },
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
    on: {
      ready: (fancybox) => {
        const slide = fancybox.getSlide()
        if (slide?.src) {
          const mediaId = slide?.triggerEl?.dataset?.mediaId
            ? parseInt(slide.triggerEl.dataset.mediaId)
            : slide?.mediaId
              ? parseInt(slide.mediaId)
              : null
          exifSidebar.setSrc(slide.src, mediaId)
        }
        window.dispatchEvent(new CustomEvent('fancybox:opened'))
      },
      'Carousel.contentReady': (fancybox, carousel, slide) => {
        if (!slide || fancybox.getSlide() !== slide) return
        const mediaId = slide?.triggerEl?.dataset?.mediaId
          ? parseInt(slide.triggerEl.dataset.mediaId)
          : slide?.mediaId
            ? parseInt(slide.mediaId)
            : null
        exifSidebar.setSrc(slide.src, mediaId)
        window.dispatchEvent(new CustomEvent('fancybox:opened'))
      },
      'Carousel.change': (fancybox) => {
        const slide = fancybox.getSlide()
        if (slide?.src) {
          const mediaId = slide?.triggerEl?.dataset?.mediaId
            ? parseInt(slide.triggerEl.dataset.mediaId)
            : slide?.mediaId
              ? parseInt(slide.mediaId)
              : null
          exifSidebar.setSrc(slide.src, mediaId)
          const currentThumb = displayedThumbnails.value.find((t) => t.id === mediaId)
          if (currentThumb) {
            const path = getSpaUrl(currentThumb)
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
          const mediaId = slide?.triggerEl?.dataset?.mediaId
            ? parseInt(slide.triggerEl.dataset.mediaId)
            : slide?.mediaId
              ? parseInt(slide.mediaId)
              : null
          exifSidebar.setSrc(slide.src, mediaId)
        }
      },
      close: () => {
        const year = route.params.year
        const month = route.params.month
        const basePath = year && month ? `/${year}/${month}` : '/'
        router.replace({ path: basePath, query: route.query })
        window.dispatchEvent(new CustomEvent('fancybox:closed'))
      },
    },
  })

  const openThumbnail = (thumb, index) => {
    const slides = displayedThumbnails.value.map((t) => ({
      src: getOriginalUrl(t),
      mediaId: t.id,
      filename: t.filename,
    }))

    Fancybox.close()
    Fancybox.show(slides, {
      ...getFancyboxOptions(),
      startIndex: index,
    })

    router.push({ path: getSpaUrl(thumb), query: route.query })
  }

  const isVideoFile = (filename) => {
    return VIDEO_EXTENSIONS.some((ext) => filename.toLowerCase().includes(ext))
  }

  const skeletonsCount = computed(() => {
    return Math.max(0, props.mediaCount - displayedThumbnails.value.length)
  })

  const shouldShowPlusButton = computed(() => {
    return !showAllThumbnails.value && props.mediaCount > THUMBNAILS_PER_EVENT + 1
  })

  const hiddenCount = computed(() => {
    return props.mediaCount - THUMBNAILS_PER_EVENT
  })

  const shouldHideThumbnail = (index) => {
    return index >= THUMBNAILS_PER_EVENT && !showAllThumbnails.value
  }

  const shouldHideSkeleton = (skeletonIndex) => {
    const skeletonPosition = displayedThumbnails.value.length + skeletonIndex
    return skeletonPosition >= THUMBNAILS_PER_EVENT && !showAllThumbnails.value
  }

  const shouldDimThumbnail = (clusterId) => {
    return (
      props.selectedClusters.length > 0 &&
      !(clusterId !== null && props.selectedClusters.map(String).includes(String(clusterId)))
    )
  }

  const shouldDimByParticipant = (thumb) => {
    if (props.selectedParticipants.length === 0) return false
    const thumbParticipants = thumb.participants || []
    return !props.selectedParticipants.some((p) => thumbParticipants.includes(p))
  }

  const loadThumbnails = async () => {
    if (loadingThumbnails.value) return

    try {
      loadingThumbnails.value = true

      const response = await fetch(`/api/events/${props.eventId}/thumbnails`)
      if (!response.ok) {
        throw new Error(t('eventThumbnails.error.load', { status: response.status }))
      }

      const responseData = await response.json()
      const thumbnails = responseData.success ? responseData.data : responseData
      displayedThumbnails.value = thumbnails

      emit('loaded', {
        eventId: props.eventId,
        thumbnails: displayedThumbnails.value,
      })
    } catch (error) {
      console.error(`Failed to load thumbnails for event ${props.eventId}:`, error)
    } finally {
      loadingThumbnails.value = false
    }
  }

  const handleImageError = (event) => {
    event.target.src =
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjU2IiBoZWlnaHQ9IjI1NiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjU2IiBoZWlnaHQ9IjI1NiIgZmlsbD0iI2VlZSIvPjx0ZXh0IHg9IjEyOCIgeT0iMTI4IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5OTkiPkltYWdlIE5vdCBGb3VuZDwvdGV4dD48L3N2Zz4='
  }

  onMounted(() => {
    if (props.mediaCount > 0) {
      loadThumbnails()
    }
    window.addEventListener('media-deleted', onMediaDeleted)
    window.addEventListener('ws:events-changed', loadThumbnails)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('media-deleted', onMediaDeleted)
    window.removeEventListener('ws:events-changed', loadThumbnails)
  })

  const onMediaDeleted = (e) => {
    const mediaId = e.detail?.mediaId
    if (mediaId != null) {
      displayedThumbnails.value = displayedThumbnails.value.filter((thumb) => thumb.id !== mediaId)
    }
  }
</script>
