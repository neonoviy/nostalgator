<template>
  <div ref="triggerElement" class="load-more-trigger">
    <div
      class="state-end-of-list"
      :class="{ 'is-hidden': loading || hasMore || totalEventsCount === 0 }"
    >
      <span>{{ $t('loadMore.endOfList') }}</span>
    </div>
    <div class="state-loading" :class="{ 'is-hidden': !loading }">
      <span>⏳ {{ $t('loadMore.loading') }}</span>
    </div>
    <button
      class="app-button state-btn-load-more"
      :class="{ 'is-hidden': loading || !hasMore }"
      @click="handleClick"
    >
      {{ $t('loadMore.loadMore') }}
    </button>
    <div
      class="state-no-events"
      :class="{ 'is-hidden': loading || hasMore || totalEventsCount > 0 }"
    >
      <template v-if="!dbHasEvents">
        <div class="no-events-hint">
          {{ $t('loadMore.noEvents') }}
          <template v-if="!isAuthenticated">
            <ul>
              <li>
                🔳
                <a href="#" class="no-events-link" @click.prevent="openLogin">{{
                  $t('loadMore.login')
                }}</a>
              </li>
              <li>🔳 {{ $t('loadMore.startScan') }}</li>
            </ul>
          </template>
          <template v-else>
            <ul>
              <li>✅ {{ $t('loadMore.login') }}</li>
              <li>
                🔳
                <a href="#" class="no-events-link" @click.prevent="openScan">{{
                  $t('loadMore.startScan')
                }}</a>
              </li>
            </ul>
          </template>
        </div>
      </template>
      <template v-else>
        <span class="no-events-hint">{{ $t('loadMore.noEvents') }}</span>
      </template>
    </div>
  </div>
</template>

<script setup>
  // Dependencies
  import { ref, onMounted, onBeforeUnmount, watch, nextTick, inject, computed } from 'vue'

  // Props
  const props = defineProps({
    loading: { type: Boolean, default: false },
    hasMore: { type: Boolean, default: true },
    totalEventsCount: { type: Number, default: 0 },
    dbHasEvents: { type: Boolean, default: true },
  })

  const emit = defineEmits(['load-more'])

  // DOM refs
  const triggerElement = ref(null)
  let observer = null

  // Injected contexts
  const auth = inject('authContext')
  const scanState = inject('scanContext')
  const settingsModal = inject('settingsModalContext')

  const isAuthenticated = computed(() => auth?.user?.value != null)
  const isAdmin = computed(() => auth?.user?.value?.role === 'admin')

  const openLogin = () => {
    auth?.openLoginModal?.()
  }

  const openScan = () => {
    if (!isAdmin.value) return
    settingsModal?.openSettingsModal?.('scan')
  }

  // Intersection / visibility handlers
  const handleIntersection = (entries) => {
    const entry = entries[0]
    if (entry.isIntersecting && !props.loading) {
      emit('load-more')
    }
  }

  const handleClick = () => {
    if (!props.loading) {
      emit('load-more')
    }
  }

  const checkVisibility = () => {
    nextTick(() => {
      if (!triggerElement.value) return
      const rect = triggerElement.value.getBoundingClientRect()
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0
      if (isVisible && !props.loading) {
        emit('load-more')
      }
    })
  }

  // Lifecycle
  onMounted(() => {
    if (!triggerElement.value) return
    observer = new IntersectionObserver(handleIntersection, {
      threshold: 0.1,
      rootMargin: '100px',
    })
    observer.observe(triggerElement.value)
    checkVisibility()
  })

  onBeforeUnmount(() => {
    if (observer) {
      observer.disconnect()
    }
  })

  // Watchers
  watch(
    () => props.loading,
    (isLoaded) => {
      if (!isLoaded) {
        checkVisibility()
      }
    },
  )
</script>
