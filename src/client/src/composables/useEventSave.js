import { ref } from 'vue'
import { getT } from '../i18n/composable.js'
import { addNotification } from './useNotifications.js'
import { sortEvents } from '../utils/sortEvents.js'
import { Fancybox } from '@fancyapps/ui'
import { useRoute, useRouter } from 'vue-router'

export function useEventSave(token, eventsByYear, eventsState, showEditModal, loadEvents) {
  const saving = ref(false)
  const t = getT()
  const route = useRoute()
  const router = useRouter()

  // Save event (path, folder name, date, tags)
  const saveEvent = async (data) => {
    saving.value = true
    try {
      const { id, folderPath, folderName, eventDate, ...changes } = data

      delete changes.onPathError

      // 1. Update path
      if (folderPath) {
        await _updatePath(id, folderPath, data)
        if (!data._pathOk) return false // error surfaced in the modal
      }

      // 2. Rename folder
      if (folderName) {
        await _renameFolder(id, folderName, data)
        if (!data._folderNameOk) return false
      }

      // 3. Update date
      if (eventDate !== undefined) {
        await _updateDate(id, eventDate, data, eventsByYear)
        if (!data._dateOk) return false
      }

      // 4. Access groups
      if (JSON.stringify(changes.allowedGroupIds) !== undefined) {
        await _updateAccess(id, changes.allowedGroupIds)
        delete changes.allowedGroupIds
      }

      // 5. Update tags
      if (Object.keys(changes).length > 0) {
        await _updateTags(id, changes, data, eventsByYear, eventsState)
      }

      return true
    } catch (error) {
      console.error('Error saving event:', error)
      addNotification('error', error.message || t('event.saveError'))
      return false
    } finally {
      saving.value = false
    }
  }

  // Delete event from DB
  const deleteEvent = async ({ id, deleteOriginals }) => {
    try {
      const response = await fetch(`/api/events/${id}`, {
        method: 'DELETE',
        headers: _headers(),
        body: JSON.stringify({ deleteOriginals }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || t('event.deleteError', { message: '' }))
      }

      // Targeted removal from local state
      const yearKey = Object.keys(eventsByYear).find((y) =>
        eventsByYear[y].events.some((e) => e.id === id),
      )
      if (yearKey) {
        const events = eventsByYear[yearKey].events
        const index = events.findIndex((e) => e.id === id)
        if (index !== -1) {
          events.splice(index, 1)
        }
      }

      showEditModal.value = false

      Fancybox.close()

      addNotification('success', t('event.deleted'), { duration: 3000 })
    } catch (error) {
      console.error('Error deleting event:', error)
      addNotification('error', t('event.deleteError', { message: error.message }))
    }
  }

  // ---- Internal methods ----

  // Helper function for year sorting
  const _sortYear = (year) => {
    if (eventsByYear[year]) {
      sortEvents(eventsByYear[year].events)
    }
  }

  // Targeted update of event in local state (without unnecessary re-render)
  const _updateEventInState = (updatedEvent) => {
    // 1. Find where the event currently is
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

    // 2. If event is not found (e.g. hidden by filters) — need year to add it
    if (!foundYear) {
      const newYear = updatedEvent.year?.toString()
      if (!newYear) return
      if (!eventsByYear[newYear]) eventsByYear[newYear] = { events: [], hasMore: true }
      eventsByYear[newYear].events.push(updatedEvent)
      _sortYear(newYear)
      return
    }

    // 3. If year has not changed — update properties of existing object
    // Object.assign preserves object reference, preventing Vue component re-render
    const newYear = updatedEvent.year?.toString()
    if (foundYear === newYear || !newYear) {
      Object.assign(eventsByYear[foundYear].events[foundIndex], updatedEvent)
      // Do NOT sort the array to avoid triggering DOM element movement and flickering
      return
    }

    // 4. If year changed — move the event
    eventsByYear[foundYear].events.splice(foundIndex, 1)
    if (!eventsByYear[newYear]) eventsByYear[newYear] = { events: [], hasMore: true }
    eventsByYear[newYear].events.push(updatedEvent)

    _sortYear(foundYear)
    _sortYear(newYear)
  }

  const _headers = () => ({
    'Content-Type': 'application/json',
    Authorization: token.value ? `Bearer ${token.value}` : '',
  })

  const _updatePath = async (id, folderPath, data) => {
    const res = await fetch(`/api/events/${id}/path`, {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify({ folderPath }),
    })

    if (!res.ok) {
      const err = await res.json()
      data._pathOk = false
      if (data.onPathError)
        data.onPathError(err.error?.message || err.error || t('event.pathUpdateError'))
      return
    }
    data._pathOk = true
  }

  const _renameFolder = async (id, folderName, data) => {
    const res = await fetch(`/api/events/${id}/path`, {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify({ folderName }),
    })

    if (!res.ok) {
      const err = await res.json()
      data._folderNameOk = false
      if (data.onFolderNameError)
        data.onFolderNameError(err.error?.message || err.error || t('event.renameError'))
      return
    }

    data._folderNameOk = true

    const result = await res.json()
    const newFolderPath = result.success ? result.data.folderPath : result.folderPath
    const newTitle = result.success ? result.data.title : result.title

    if (newFolderPath || newTitle) {
      let currentYear = null
      let oldFolderPath = null
      for (const year in eventsByYear) {
        const ev = eventsByYear[year].events.find((e) => e.id === id)
        if (ev) {
          currentYear = year
          oldFolderPath = ev.folderPath
          break
        }
      }

      _updateEventInState({
        id,
        folderPath: newFolderPath,
        title: newTitle,
        year: currentYear,
      })

      if (oldFolderPath && newFolderPath && route.params.month === oldFolderPath.split('/')[1]) {
        const newMonth = newFolderPath.split('/')[1]
        const newYear = newFolderPath.split('/')[0]
        router.replace({ params: { ...route.params, year: newYear, month: newMonth } })
      }
    }
  }

  const _updateDate = async (id, eventDate, data, eventsByYearArg) => {
    const eventDateValue = eventDate
      ? (() => {
          const d = new Date(eventDate)
          const year = d.getFullYear()
          const month = String(d.getMonth() + 1).padStart(2, '0')
          const day = String(d.getDate()).padStart(2, '0')
          return `${year}-${month}-${day}`
        })()
      : null

    const res = await fetch(`/api/events/${id}/date`, {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify({ eventDate: eventDateValue }),
    })

    if (!res.ok) {
      const err = await res.json()
      data._dateOk = false
      if (data.onDateError)
        data.onDateError(err.error?.message || err.error || t('event.dateUpdateError'))
      return
    }

    // Get the full up-to-date event (year may have changed)
    const eventData = await fetch(`/api/events/${id}`).then((r) => r.json())
    const updatedEventData = eventData.success ? eventData.data : eventData

    // Update local state (move between years if necessary)
    _updateEventInState(updatedEventData)

    data._dateOk = true
  }

  const _updateAccess = async (id, allowedGroupIds) => {
    const res = await fetch(`/api/events/${id}/access`, {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify({ allowedGroupIds }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || t('eventSave.error.updateAccess'))
    }

    const responseData = await res.json()
    const updatedEvent = responseData.success ? responseData.data : responseData
    if (updatedEvent) {
      let eventAllowedGroupIds = []
      try {
        if (updatedEvent.allowedGroupIds) {
          eventAllowedGroupIds = JSON.parse(updatedEvent.allowedGroupIds)
        }
      } catch (e) {
        /* ignore */
      }

      _updateEventInState({
        id: updatedEvent.id,
        allowedGroupIds: eventAllowedGroupIds,
      })
    }
  }

  const _updateTags = async (id, changes, data, eventsByYearRef, eventsStateRef) => {
    const res = await fetch(`/api/events/${id}/tags`, {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify(changes),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(t('eventSave.error.saveTags', { status: res.status }))
    }

    const responseData = await res.json()
    const { event: updatedEvent } = responseData.success ? responseData.data : responseData
    if (!updatedEvent) throw new Error('Server returned no event')

    // Update event in local state (accounting for year change if date changed)
    _updateEventInState(updatedEvent)
  }

  return { saveEvent, deleteEvent, saving }
}
