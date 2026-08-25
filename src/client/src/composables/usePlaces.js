import { ref, watch, onUnmounted } from 'vue'
import { useUrlFilters } from './useUrlFilters.js'

export function usePlaces(tokenRef = null) {
  const urlFilters = useUrlFilters()
  const token = tokenRef || ref(null)

  // State
  const places = ref([])
  const isLoading = ref(false)

  // Load places
  const loadPlaces = async () => {
    try {
      isLoading.value = true

      const params = new URLSearchParams()
      if (urlFilters.filters.years && urlFilters.filters.years.length) {
        params.set('years', JSON.stringify(urlFilters.filters.years))
      }

      const res = await fetch(`/api/places${params.toString() ? '?' + params.toString() : ''}`, {
        headers: {
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
      })

      if (!res.ok) {
        isLoading.value = false
        return
      }

      const data = await res.json()
      const placesData = data.success ? data.data : data

      if (Array.isArray(placesData)) {
        places.value = placesData
      }
    } catch (e) {
      console.error('Load places error:', e)
    } finally {
      isLoading.value = false
    }
  }

  const stopWatch = watch(
    () => urlFilters.filters.years,
    () => {
      loadPlaces()
    },
  )
  onUnmounted(() => {
    if (typeof stopWatch === 'function') {
      stopWatch()
    }
  })

  return {
    places,
    loadPlaces,
  }
}
