import { reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

let sharedFilters = null

export function useUrlFilters() {
  const route = useRoute()
  const router = useRouter()

  if (!sharedFilters) {
    sharedFilters = reactive({
      years: [],
      eventTypes: [],
      places: [],
      participants: [],
      tags: [],
      clusters: [],
      search: '',
    })
  }

  const filters = sharedFilters

  // Extract filters from URL
  const parseCsv = (value) => {
    if (!value || typeof value !== 'string') return []
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }

  const syncFromUrl = () => {
    try {
      filters.years = []
      filters.eventTypes = []
      filters.places = []
      filters.participants = []
      filters.tags = []
      filters.clusters = []
      filters.search = ''

      if (route.query.years) {
        filters.years = parseCsv(route.query.years)
      }
      if (route.query.eventTypes) {
        filters.eventTypes = parseCsv(route.query.eventTypes)
      }
      if (route.query.places) {
        filters.places = parseCsv(route.query.places)
      }
      if (route.query.participants) {
        filters.participants = parseCsv(route.query.participants)
      }
      if (route.query.tags) {
        filters.tags = parseCsv(route.query.tags)
      }
      if (route.query.clusters) {
        filters.clusters = parseCsv(route.query.clusters).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      }
      if (route.query.search) {
        try {
          filters.search = decodeURIComponent(route.query.search)
        } catch {
          filters.search = ''
        }
      }
    } catch (e) {
      console.error('Parse filters error:', e)
    }
    console.log('[useUrlFilters] syncFromUrl done, filters:', filters)
  }

  // Update URL and sync filters
  const updateUrl = (newFilters) => {
    const query = { ...route.query }
    Object.entries(newFilters).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        query[key] = value.join(',')
      } else if (typeof value === 'string' && value.trim()) {
        query[key] = value
      } else {
        delete query[key]
      }
    })
    router.replace({ query })
    // Synchronously update filters (router.replace is async, but we need instant)
    Object.entries(newFilters).forEach(([key, value]) => {
      filters[key] = value
    })
  }

  // Expose methods for updating URL
  const toggleFilter = (filterType, value, isChecked) => {
    const current = [...(filters[filterType] || [])]
    const newValues = isChecked ? [...current, value] : current.filter((v) => v !== value)
    updateUrl({ ...filters, [filterType]: newValues })
  }

  const setSearch = (search) => {
    updateUrl({ ...filters, search })
  }

  const clearAllFilters = () => {
    router.replace({ query: {} })
    // Reset reactive filters object
    Object.keys(filters).forEach((key) => {
      if (Array.isArray(filters[key])) {
        filters[key] = []
      } else {
        filters[key] = ''
      }
    })
  }

  const filtersEqual = (a, b) => {
    const keys = ['years', 'eventTypes', 'places', 'participants', 'tags', 'clusters', 'search']
    for (const key of keys) {
      const valA = a[key]
      const valB = b[key]
      if (Array.isArray(valA) && Array.isArray(valB)) {
        if (valA.length !== valB.length) return false
        if (valA.some((v, i) => v !== valB[i])) return false
      } else if (valA !== valB) {
        return false
      }
    }
    return true
  }

  const getFiltersFromQuery = (query) => {
    const result = {
      years: [],
      eventTypes: [],
      places: [],
      participants: [],
      tags: [],
      clusters: [],
      search: '',
    }
    if (query.years) {
      try {
        result.years = query.years
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      } catch {
        result.years = []
      }
    }
    if (query.eventTypes) {
      try {
        result.eventTypes = query.eventTypes
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      } catch {
        result.eventTypes = []
      }
    }
    if (query.places) {
      try {
        result.places = query.places
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      } catch {
        result.places = []
      }
    }
    if (query.participants) {
      try {
        result.participants = query.participants
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      } catch {
        result.participants = []
      }
    }
    if (query.tags) {
      try {
        result.tags = query.tags
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      } catch {
        result.tags = []
      }
    }
    if (query.clusters) {
      try {
        result.clusters = query.clusters
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0)
      } catch {
        result.clusters = []
      }
    }
    if (query.search) {
      try {
        result.search = decodeURIComponent(query.search)
      } catch {
        result.search = ''
      }
    }
    return result
  }

  // Sync on URL change (once on start + on URL change)
  watch(
    () => route.query,
    () => {
      const newFilters = getFiltersFromQuery(route.query)
      if (!filtersEqual(newFilters, filters)) {
        syncFromUrl()
      }
    },
    { immediate: true },
  )

  return {
    filters,
    toggleFilter,
    setSearch,
    clearAllFilters,
    syncFromUrl,
  }
}
