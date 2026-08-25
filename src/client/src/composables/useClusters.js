import { ref, watch, onUnmounted } from 'vue'
import { useUrlFilters } from './useUrlFilters.js'

export function useClusters(tokenRef = null) {
  const urlFilters = useUrlFilters()
  const token = tokenRef || ref(null)

  // State
  const clusters = ref([])
  const currentClusterId = ref(null)
  const isLoading = ref(false)

  // Load clusters
  const loadClusters = async () => {
    try {
      isLoading.value = true

      const params = new URLSearchParams()
      if (urlFilters.filters.years && urlFilters.filters.years.length) {
        params.set('years', JSON.stringify(urlFilters.filters.years))
      }
      if (urlFilters.filters.places && urlFilters.filters.places.length) {
        params.set('places', JSON.stringify(urlFilters.filters.places))
      }
      if (urlFilters.filters.eventTypes && urlFilters.filters.eventTypes.length) {
        params.set('eventTypes', JSON.stringify(urlFilters.filters.eventTypes))
      }
      if (urlFilters.filters.participants && urlFilters.filters.participants.length) {
        params.set('participants', JSON.stringify(urlFilters.filters.participants))
      }
      if (urlFilters.filters.tags && urlFilters.filters.tags.length) {
        params.set('tags', JSON.stringify(urlFilters.filters.tags))
      }

      console.log('[useClusters] Fetching with params:', params.toString())
      const res = await fetch(`/api/clusters${params.toString() ? '?' + params.toString() : ''}`, {
        headers: {
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
      })

      if (!res.ok) {
        isLoading.value = false
        return
      }

      const data = await res.json()
      const clustersData = data.success ? data.data : data

      console.log(
        '[useClusters] Received clusters count:',
        Array.isArray(clustersData) ? clustersData.length : 'not an array',
      )

      if (Array.isArray(clustersData)) {
        clusters.value = clustersData
      }
    } catch (e) {
      console.error('Load clusters error:', e)
    } finally {
      isLoading.value = false
    }
  }

  const stopWatch = watch(urlFilters.filters, () => loadClusters(), { deep: true })

  onUnmounted(() => {
    if (typeof stopWatch === 'function') {
      stopWatch()
    }
  })

  // Selection
  const selectCluster = (clusterId) => {
    if (currentClusterId.value === clusterId) {
      currentClusterId.value = null
    } else {
      currentClusterId.value = clusterId
    }
  }

  return {
    clusters,
    currentClusterId,
    loadClusters,
    selectCluster,
  }
}
