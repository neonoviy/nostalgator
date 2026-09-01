import { ref, reactive, watch, computed, nextTick } from 'vue'
import { useUrlFilters } from './useUrlFilters.js'
import { EVENTS_PER_PAGE } from '../config.js'
import { sortEvents } from '../utils/sortEvents.js'
import { getT } from '../i18n/composable.js'

const debounce = (fn, delay) => {
  let timeoutId
  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

export function useEvents(tokenRef = null, userRef = null) {
  const t = getT()
  const urlFilters = useUrlFilters()

  const token = tokenRef || ref(null)
  const user = userRef || ref(null)

  const years = ref([])
  const eventsByYear = reactive({})
  const updateKey = ref(Date.now())
  const nextCursor = ref(null)
  const loading = ref(false)
  const hasMore = ref(true)
  const places = ref([])
  const eventTypes = ref([])
  const people = ref([])
  const tags = ref([])
  const selectedYears = ref([])
  const selectedPlaces = ref([])
  const selectedEventTypes = ref([])
  const selectedParticipants = ref([])
  const selectedTags = ref([])
  const selectedClusters = ref([])
  const hasInitializedEvents = ref(false)
  const dbHasEvents = ref(true)

  const yearCounts = ref({})
  const tagCounts = ref({
    places: {},
    eventTypes: {},
    participants: {},
    tags: {},
  })

  const syncSelectedFromUrlFilters = () => {
    selectedYears.value = urlFilters.filters.years
    selectedPlaces.value = urlFilters.filters.places
    selectedEventTypes.value = urlFilters.filters.eventTypes
    selectedParticipants.value = urlFilters.filters.participants
    selectedTags.value = urlFilters.filters.tags
    selectedClusters.value = urlFilters.filters.clusters
    // Search is synchronized automatically via watch(urlFilters.filters)
  }

  const buildEventsUrl = (cursor, limit) => {
    const params = new URLSearchParams()
    if (selectedYears.value.length) params.set('years', JSON.stringify(selectedYears.value))
    if (selectedEventTypes.value.length)
      params.set('eventTypes', JSON.stringify(selectedEventTypes.value))
    if (selectedPlaces.value.length) params.set('places', JSON.stringify(selectedPlaces.value))
    if (selectedParticipants.value.length)
      params.set('participants', JSON.stringify(selectedParticipants.value))
    if (selectedTags.value.length) params.set('tags', JSON.stringify(selectedTags.value))
    if (selectedClusters.value.length)
      params.set('clusters', JSON.stringify(selectedClusters.value))

    if (urlFilters.filters.search && urlFilters.filters.search.trim()) {
      params.set('search', encodeURIComponent(urlFilters.filters.search.trim()))
    }

    if (cursor) params.set('cursor', cursor)
    params.set('limit', limit)
    const qs = params.toString()
    return `/api/events${qs ? '?' + qs : ''}`
  }

  const loadTagCounts = async () => {
    try {
      const filters = {}
      if (selectedYears.value.length) filters.years = selectedYears.value
      if (selectedEventTypes.value.length) filters.eventTypes = selectedEventTypes.value
      if (selectedPlaces.value.length) filters.places = selectedPlaces.value
      if (selectedParticipants.value.length) filters.participants = selectedParticipants.value
      if (selectedTags.value.length) filters.tags = selectedTags.value

      const params = new URLSearchParams()
      Object.keys(filters).forEach((key) => {
        if (filters[key].length) {
          params.set(key, JSON.stringify(filters[key]))
        }
      })
      const qs = params.toString()

      const [yearCountsRes, tagsRes] = await Promise.all([
        fetch(`/api/years/counts${qs ? '?' + qs : ''}`, {
          headers: {
            Authorization: token.value ? `Bearer ${token.value}` : '',
          },
        }),
        fetch(`/api/tags${qs ? '?' + qs : ''}`, {
          headers: {
            Authorization: token.value ? `Bearer ${token.value}` : '',
          },
        }),
      ])

      if (!yearCountsRes.ok || !tagsRes.ok) return

      const yearCountsData = await yearCountsRes.json()
      const tagsData = await tagsRes.json()

      const yearCountsArr = yearCountsData.success ? yearCountsData.data : yearCountsData
      const tagsArr = tagsData.success ? tagsData.data : tagsData

      if (!Array.isArray(yearCountsArr) || !tagsArr || typeof tagsArr !== 'object') return

      yearCounts.value = Object.fromEntries(yearCountsArr.map((y) => [y.year, y.count]))

      const newPlaces = (tagsArr.places || []).map((p) => ({
        id: p.id,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        polygon: p.polygon,
      }))
      const newEventTypes = (tagsArr.eventTypes || []).map((e) => ({ id: e.id, type: e.name }))
      const newPeople = (tagsArr.participants || []).map((p) => ({ id: p.id, name: p.name }))
      const newTags = (tagsArr.tags || []).map((tag) => ({ id: tag.id, name: tag.name }))

      places.value = newPlaces
      eventTypes.value = newEventTypes
      people.value = newPeople
      tags.value = newTags

      tagCounts.value = {
        places: Object.fromEntries(tagsArr.places.map((p) => [p.name, p.count])),
        eventTypes: Object.fromEntries(tagsArr.eventTypes.map((e) => [e.name, e.count])),
        participants: Object.fromEntries(tagsArr.participants.map((p) => [p.name, p.count])),
        tags: Object.fromEntries(tagsArr.tags.map((tag) => [tag.name, tag.count])),
      }
    } catch (e) {
      console.error('Load tag counts error:', e)
    }
  }

  const checkDbHasEvents = async () => {
    try {
      const res = await fetch('/api/events/has-events', {
        headers: {
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
      })
      if (!res.ok) {
        dbHasEvents.value = false
        return
      }
      const data = await res.json()
      const result = data.success ? data.data : data
      dbHasEvents.value = result.hasEvents !== false
    } catch (e) {
      dbHasEvents.value = false
    }
  }

  const loadYears = async () => {
    try {
      const res = await fetch('/api/years', {
        headers: {
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
      })
      if (!res.ok) return
      const data = await res.json()
      const yearsData = data.success ? data.data : data
      if (!Array.isArray(yearsData)) return
      years.value = yearsData
    } catch (e) {
      console.error('Load years error:', e)
    }
  }

  const initYearsState = () => {
    years.value.forEach((year) => {
      if (!eventsByYear[year]) eventsByYear[year] = { events: [], hasMore: true }
    })
  }

  let isLoading = false
  const loadEvents = async (add = false) => {
    if (isLoading) return
    isLoading = true
    loading.value = true

    try {
      if (!add) {
        nextCursor.value = null
        hasMore.value = true
        await loadYears()
      } else if (!hasMore.value) {
        return
      }

      const url = buildEventsUrl(nextCursor.value, EVENTS_PER_PAGE)
      const res = await fetch(url, {
        headers: {
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
      })
      if (!res.ok) {
        throw new Error(t('events.error.serverNotReady', { status: res.status }))
      }
      const data = await res.json()
      const responseData = data.success ? data.data : data
      const events = responseData.events || []

      if (!add) {
        Object.keys(eventsByYear).forEach((y) => delete eventsByYear[y])
        updateKey.value = Date.now()
        initYearsState()
      }

      if (events.length === 0) {
        hasMore.value = false
        Object.values(eventsByYear).forEach((y) => (y.hasMore = false))
      } else {
        events.forEach((event) => {
          const year = event.year
          if (!eventsByYear[year]) {
            eventsByYear[year] = { events: [], hasMore: true }
            const yearExists = years.value.includes(year)
            if (!yearExists) {
              years.value.push(year)
            }
          }
          eventsByYear[year].events.push(event)
        })

        Object.keys(eventsByYear).forEach((year) => {
          sortEvents(eventsByYear[year].events)
        })

        nextCursor.value = responseData.nextCursor || null
        if (!nextCursor.value) {
          hasMore.value = false
          Object.values(eventsByYear).forEach((y) => (y.hasMore = false))
        }
        // Mark that we have initialized events at least once
        hasInitializedEvents.value = true
      }
    } catch (e) {
      console.error('Load events error:', e)
    } finally {
      loading.value = false
      isLoading = false
    }
  }

  const toggleFilter = (filterType, value, isChecked) => {
    urlFilters.toggleFilter(filterType, value, isChecked)
  }

  const clearAllFilters = () => {
    console.log('[useEvents] clearAllFilters called')
    urlFilters.clearAllFilters()
  }

  const visibleYears = computed(() => years.value.filter((y) => eventsByYear[y]?.events.length > 0))
  const totalEventsCount = computed(() =>
    Object.values(eventsByYear).reduce((s, y) => s + y.events.length, 0),
  )

  // Watch: URL filters → selected* + load events
  watch(
    urlFilters.filters,
    async (newFilters, oldFilters) => {
      console.log('[useEvents] watch urlFilters.filters triggered', { newFilters, oldFilters })
      if (!hasInitializedEvents.value) {
        hasInitializedEvents.value = true
        syncSelectedFromUrlFilters()
        console.log('[useEvents] First init, sync from URL')
        return
      }
      syncSelectedFromUrlFilters()
      console.log('[useEvents] About to load events with filters:', newFilters)
      await loadEvents(false)
      console.log('[useEvents] Events loaded')
    },
    { deep: true },
  )

  // Watch: filters → update counters (debounce 300ms)
  watch(
    [
      selectedYears,
      selectedPlaces,
      selectedEventTypes,
      selectedParticipants,
      selectedTags,
      selectedClusters,
    ],
    debounce(async () => {
      await loadTagCounts()
    }, 300),
  )

  watch(
    () => user.value?.id,
    async (newId, oldId) => {
      if (newId !== oldId) {
        await loadTagCounts()
        await loadEvents(false)
      }
    },
  )

  // ============================================================================
  // Methods for editing tags
  // ============================================================================

  const updateTagInEvents = (tagType, oldName, newName) => {
    Object.values(eventsByYear).forEach((year) => {
      if (!year) return
      year.events.forEach((event) => {
        if (!event) return
        const field = tagType === 'eventTypes' ? 'eventType' : tagType
        if (Array.isArray(event[field])) {
          const idx = event[field].indexOf(oldName)
          if (idx !== -1) {
            event[field][idx] = newName
          }
        }
      })
    })
  }

  const removeTagFromEvents = (tagType, tagName) => {
    Object.values(eventsByYear).forEach((year) => {
      if (!year) return
      year.events.forEach((event) => {
        if (!event) return
        const field = tagType === 'eventTypes' ? 'eventType' : tagType
        if (Array.isArray(event[field])) {
          event[field] = event[field].filter((tag) => tag !== tagName)
        }
      })
    })
  }

  const renameTag = async (tagType, tagId, newName, oldName) => {
    try {
      const response = await fetch(`/api/tags/${tagType}/${tagId}/rename`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
        body: JSON.stringify({ name: newName }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || errorData.error || t('events.renameError'))
      }

      updateTagInEvents(tagType, oldName, newName)
      await loadTagCounts()

      return { success: true }
    } catch (error) {
      console.error('Failed to rename tag:', error)
      throw error
    }
  }

  const deleteTag = async (tagType, tagId, tagName) => {
    try {
      const response = await fetch(`/api/tags/${tagType}/${tagId}`, {
        method: 'DELETE',
        headers: {
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || errorData.error || t('events.deleteError'))
      }

      const responseData = await response.json()
      const data = responseData.success ? responseData.data : responseData

      removeTagFromEvents(tagType, tagName)
      await loadTagCounts()

      return { eventsAffected: data.eventsAffected }
    } catch (error) {
      console.error('Failed to delete tag:', error)
      throw error
    }
  }

  const updateEventParticipants = (eventId, participantName, action) => {
    for (const year in eventsByYear) {
      const event = eventsByYear[year].events.find((e) => e.id === eventId)
      if (event) {
        if (action === 'add') {
          if (!Array.isArray(event.participants)) event.participants = []
          if (!event.participants.includes(participantName)) {
            event.participants = [...event.participants, participantName]
          }
        } else if (action === 'remove') {
          if (Array.isArray(event.participants)) {
            event.participants = event.participants.filter((p) => p !== participantName)
          }
        }
        break
      }
    }
  }

  const updateEventInState = (updatedEvent) => {
    let foundYear = null
    let foundIndex = -1

    for (const year in eventsByYear) {
      const idx = eventsByYear[year].events.findIndex((e) => Number(e.id) === Number(updatedEvent.id))
      if (idx !== -1) {
        foundYear = year
        foundIndex = idx
        break
      }
    }

    if (!foundYear) {
      const newYear = updatedEvent.year?.toString()
      if (!newYear) return
      if (!eventsByYear[newYear]) eventsByYear[newYear] = { events: [], hasMore: true }
      eventsByYear[newYear].events.push(updatedEvent)
      sortEvents(eventsByYear[newYear].events)
      return
    }

    const newYear = updatedEvent.year?.toString()
    if (foundYear === newYear || !newYear) {
      Object.assign(eventsByYear[foundYear].events[foundIndex], updatedEvent)
      return
    }

    eventsByYear[foundYear].events.splice(foundIndex, 1)
    if (!eventsByYear[newYear]) eventsByYear[newYear] = { events: [], hasMore: true }
    eventsByYear[newYear].events.push(updatedEvent)
    sortEvents(eventsByYear[foundYear].events)
    sortEvents(eventsByYear[newYear].events)
  }

  return {
    years,
    eventsByYear,
    visibleYears,
    totalEventsCount,
    loading,
    hasMore,
    updateKey,
    dbHasEvents,
    checkDbHasEvents,
    places,
    eventTypes,
    people,
    tags,
    tagCounts,
    yearCounts,
    selectedYears,
    selectedPlaces,
    selectedEventTypes,
    selectedParticipants,
    selectedTags,
    selectedClusters,
    loadTagCounts,
    loadYears,
    loadEvents,
    toggleFilter,
    clearAllFilters,
    renameTag,
    deleteTag,
    syncSelectedFromUrlFilters,
    updateEventParticipants,
    updateEventInState,
  }
}
