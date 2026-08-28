<template>
  <div
    class="event-card"
    :class="{ 'is-editing': isEditing }"
    :data-event-id="event.id"
    :data-event-folder="eventFolder"
  >
    <div class="event-header">
      <div>
        <h3>{{ event.title }}</h3>
        <!-- Display event tags -->
        <div class="event-tags">
          <span class="tag-group">{{ pluralizeFiles(event.mediaCount) }}.</span>
          <div class="tag-group" v-if="sortedParticipants.length > 0">
            <span
              v-for="(participant, idx) in sortedParticipants"
              :key="'part-' + idx"
              class="tag participants-tag"
            >
              {{ participant }}<span v-if="idx < sortedParticipants.length - 1">, </span> </span
            >.
          </div>
          <div class="tag-group" v-if="sortedPlaces.length > 0">
            <span v-for="(loc, idx) in sortedPlaces" :key="'loc-' + idx" class="tag location-tag">
              {{ loc }}<span v-if="idx < sortedPlaces.length - 1">, </span> </span
            >.
          </div>
          <div class="tag-group" v-if="sortedEventTypes.length > 0">
            <span v-for="(type, idx) in sortedEventTypes" :key="'type-' + idx" class="tag type-tag">
              {{ type }}<span v-if="idx < sortedEventTypes.length - 1">, </span> </span
            >.
          </div>
          <div class="tag-group" v-if="sortedTags.length > 0">
            <span v-for="(tag, idx) in sortedTags" :key="'tag-' + idx" class="tag custom-tag">
              {{ tag }}<span v-if="idx < sortedTags.length - 1">, </span> </span
            >.
          </div>
          <span
            v-if="isAdmin && isEventRestricted"
            class="restricted-icon"
            title="$t('event.privateToGroups')"
            >🔒</span
          >
        </div>
      </div>
      <div class="event-actions">
        <AppButton
          v-if="isAdmin"
          class="edit-button"
          icon-only
          @click.stop="$emit('edit-event', event)"
          v-tooltip="$t('common.edit')"
          >✏️</AppButton
        >
      </div>
    </div>

    <!-- Thumbnails -->
    <EventThumbnails
      :event-id="event.id"
      :media-count="event.mediaCount"
      :folder-path="event.folderPath"
      :selected-clusters="effectiveSelectedClusters"
      :selected-participants="filterContext.selectedParticipants.value"
      @loaded="$emit('thumbnails-loaded', $event)"
    />
  </div>
</template>

<script setup>
  import { computed, inject } from 'vue'
  import { useI18n } from 'vue-i18n'
  import EventThumbnails from './EventThumbnails.vue'
  import AppButton from '../ui/AppButton.vue'
  import { usePluralize } from '@/composables/usePluralize'

  const { t } = useI18n()
  const { pluralize } = usePluralize()

  const pluralizeFiles = (count) => {
    const form = pluralize(count, {
      one: 'event.filesCount_one',
      few: 'event.filesCount_few',
      many: 'event.filesCount_many',
      other: 'event.filesCount_other',
    })
    return t(form, { count })
  }

  // Auth from context
  const auth = inject('authContext')
  const { isAdmin } = auth

  // Filters from context
  const filterContext = inject('filterContext')
  const effectiveSelectedClusters = computed(() => {
    const all = new Set()
    // Add directly selected clusters
    const selectedClusters = filterContext.selectedClusters.value || []
    selectedClusters.forEach((id) => all.add(id))

    // Add clusters from selected places
    const selectedPlaces = filterContext.selectedPlaces.value || []
    const places = filterContext.places.value || []
    const clusters = filterContext.clusters.value || []

    selectedPlaces.forEach((placeName) => {
      const place = places.find((p) => p.name === placeName)
      if (place && place.id) {
        clusters.forEach((cluster) => {
          if (cluster.placeIds && cluster.placeIds.includes(place.id)) {
            all.add(cluster.id)
          }
        })
      }
    })

    return [...all]
  })

  const isEventRestricted = computed(() => {
    const ids = props.event.allowedGroupIds
    if (Array.isArray(ids)) return ids.length > 0
    if (typeof ids === 'string') {
      try {
        const parsed = JSON.parse(ids)
        return Array.isArray(parsed) && parsed.length > 0
      } catch {
        return false
      }
    }
    return false
  })

  // Props
  const props = defineProps({
    event: { type: Object, required: true },
    isEditing: { type: Boolean, default: false },
  })

  // Emits
  defineEmits(['thumbnails-loaded', 'edit-event'])

  const eventFolder = computed(() => {
    const parts = props.event.folderPath?.split('/')
    return parts?.[1] || ''
  })

  // Computed
  const hasTags = computed(() => {
    return (
      (Array.isArray(sortedPlaces.value) && sortedPlaces.value.length > 0) ||
      (Array.isArray(sortedEventTypes.value) && sortedEventTypes.value.length > 0) ||
      (Array.isArray(sortedParticipants.value) && sortedParticipants.value.length > 0) ||
      (Array.isArray(sortedTags.value) && sortedTags.value.length > 0)
    )
  })

  const sortAlpha = (arr) => {
    return [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b)))
  }

  const sortedParticipants = computed(() => sortAlpha(props.event.participants))
  const sortedPlaces = computed(() => sortAlpha(props.event.places))
  const sortedEventTypes = computed(() => sortAlpha(props.event.eventType))
  const sortedTags = computed(() => sortAlpha(props.event.tags))
</script>
