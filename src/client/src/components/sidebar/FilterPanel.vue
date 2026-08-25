<template>
  <div class="filter-panel">
    <div class="filter-panel-scroll">
      <!-- By years (not editable) -->
      <SectionFilter
        :title="$t('filter.years')"
        :items="years"
        :selected="selectedYears"
        :counts="yearCounts"
        filter-type="years"
        :has-context-menu="false"
        @change="onFilterChange"
      />
      <!-- By participants -->
      <SectionFilter
        :title="$t('filter.participants')"
        :items="people"
        type="participant"
        :selected="selectedParticipants"
        :counts="tagCounts.participants"
        filter-type="participants"
        @change="onFilterChange"
        @context-menu="showContextMenu"
      />

      <!-- By places -->
      <SectionFilter
        :title="$t('filter.places')"
        :items="places"
        type="location"
        :selected="selectedPlaces"
        :counts="tagCounts.places"
        filter-type="places"
        @change="onFilterChange"
        @context-menu="showContextMenu"
        @hover="onHoverPlace"
      />

      <!-- By event types -->
      <SectionFilter
        :title="$t('filter.eventTypes')"
        :items="eventTypes"
        type="eventType"
        key-field="type"
        :selected="selectedEventTypes"
        :counts="tagCounts.eventTypes"
        filter-type="eventTypes"
        @change="onFilterChange"
        @context-menu="showContextMenu"
      />

      <!-- Other tags -->
      <SectionFilter
        :title="$t('filter.tags')"
        :items="tags"
        :selected="selectedTags"
        :counts="tagCounts.tags"
        filter-type="tags"
        @change="onFilterChange"
        @context-menu="showContextMenu"
      />
    </div>
    <!-- Reset filters button -->
    <div class="container clear-filters-container" :class="{ active: hasActiveFilters }">
      <AppButton
        class="clear-filters-button"
        variant="primary"
        :disabled="!hasActiveFilters"
        @click="clearAllFilters"
      >
        {{ $t('filter.clearAll') }}
      </AppButton>
    </div>

    <!-- Context menu -->
    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :tag-type="contextMenu.tagType"
      @rename="startRename"
      @delete="confirmDelete"
      @close="closeContextMenu"
      @set-coordinates="setCoordinates"
    />

    <!-- Delete confirmation dialog -->
    <Modal
      v-model="showDeleteConfirm"
      :title="$t('tag.deleteTitle')"
      type="confirm"
      :confirm-text="$t('common.delete')"
      confirm-class="danger"
      @confirm="deleteTagConfirmed"
    >
      <p>{{ $t('tag.deleteConfirm', { name: deleteMessageName }) }}</p>
      <p v-if="deleteMessageCount > 0">
        {{ $t('tag.deleteConfirmWithCount', { count: deleteMessageCount }) }}
      </p>
      <p>{{ $t('tag.deleteWarning') }}</p>
    </Modal>

    <!-- Tag editing modal -->
    <Modal
      v-model="showEditModal"
      :title="$t('tag.renameTitle')"
      size="small"
      :close-on-click-outside="false"
      @close="showEditModal.value = false"
    >
      <EditTagModal
        :tag-type="editingTagType"
        :tag-name="editingTagName"
        :is-loading="isSaving"
        :error="editError"
        @update:error="editError = $event"
        @save="saveTag"
        @cancel="cancelEdit"
      />
    </Modal>
  </div>
</template>

<script setup>
  import { computed, inject, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { addNotification } from '../../composables/useNotifications.js'
  import ContextMenu from './ContextMenu.vue'
  import Modal from '../ui/Modal.vue'
  import EditTagModal from './EditTagModal.vue'
  import AppButton from '../ui/AppButton.vue'
  import SectionFilter from './SectionFilter.vue'

  const { t } = useI18n()

  // Authentication from context
  const auth = inject('authContext')
  const { isAdmin } = auth

  // Get filter data from App.vue via provide/inject
  const filterContext = inject('filterContext')

  // Function to start polygon drawing mode
  const startPolygonDrawing = filterContext?.startPolygonDrawing

  const years = computed(() => filterContext.years.value)
  const yearCounts = computed(() => filterContext.yearCounts.value)
  const places = computed(() => filterContext.places.value)
  const eventTypes = computed(() => filterContext.eventTypes.value)
  const people = computed(() => filterContext.people.value)
  const tags = computed(() => filterContext.tags.value)
  const tagCounts = computed(() => filterContext.tagCounts.value)
  const selectedYears = computed(() => filterContext.selectedYears.value)
  const selectedPlaces = computed(() => filterContext.selectedPlaces.value)
  const selectedEventTypes = computed(() => filterContext.selectedEventTypes.value)
  const selectedParticipants = computed(() => filterContext.selectedParticipants.value)
  const selectedTags = computed(() => filterContext.selectedTags.value)
  const selectedClusters = computed(() => filterContext.selectedClusters.value)
  const toggleFilter = filterContext.toggleFilter
  const clearAllFilters = filterContext.clearAllFilters
  const renameTag = filterContext.renameTag
  const deleteTag = filterContext.deleteTag

  // Context menu
  const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    tagType: null,
    tag: null,
  })

  // Edit modal
  const showEditModal = ref(false)
  const editingTagType = ref('')
  const editingTagId = ref(null)
  const editingTagName = ref('')
  const editingTagOldName = ref('')
  const isSaving = ref(false)
  const editError = ref('')

  // Delete dialog
  const showDeleteConfirm = ref(false)
  const deleteMessageName = ref('')
  const deleteMessageCount = ref(0)
  const tagToDelete = ref(null)

  // Filter change handler
  const onFilterChange = (filterType, value, event) => {
    const isChecked = typeof event === 'boolean' ? event : event.target.checked
    toggleFilter(filterType, value, isChecked)
  }

  const onHoverPlace = (placeData) => {
    if (!filterContext) return
    if (!placeData) {
      filterContext.clearHoveredPlace?.()
      return
    }
    const full = (filterContext.fullPlaces?.value || []).find((p) => p.id === placeData.id)
    filterContext.setHoveredPlace?.(full || placeData)
  }

  // Check: are there active filters
  const hasActiveFilters = computed(() => {
    return (
      selectedYears.value.length > 0 ||
      selectedPlaces.value.length > 0 ||
      selectedEventTypes.value.length > 0 ||
      selectedParticipants.value.length > 0 ||
      selectedTags.value.length > 0 ||
      selectedClusters.value.length > 0
    )
  })

  // Show context menu (admin only)
  const showContextMenu = (event, tagType, tag) => {
    if (!isAdmin.value) return

    event.preventDefault()
    contextMenu.value = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      tagType,
      tag,
    }
  }

  // Close context menu
  const closeContextMenu = () => {
    contextMenu.value.visible = false
  }

  const setCoordinates = () => {
    const { tag } = contextMenu.value
    if (tag && tag.id && startPolygonDrawing) {
      startPolygonDrawing(tag.id)
    }
    closeContextMenu()
  }

  // Start renaming
  const startRename = () => {
    const { tagType, tag } = contextMenu.value
    const nameField = tagType === 'eventTypes' ? 'type' : 'name'

    editingTagType.value = tagType
    editingTagId.value = tag.id
    editingTagName.value = tag[nameField]
    editingTagOldName.value = tag[nameField]
    showEditModal.value = true

    closeContextMenu()
  }

  // Save tag
  const saveTag = async (newName) => {
    isSaving.value = true
    editError.value = ''

    try {
      await renameTag(editingTagType.value, editingTagId.value, newName, editingTagOldName.value)
      cancelEdit()
    } catch (error) {
      editError.value = error.message || t('tag.renameError')
    } finally {
      isSaving.value = false
    }
  }

  // Cancel editing
  const cancelEdit = () => {
    showEditModal.value = false
    editingTagType.value = ''
    editingTagId.value = null
    editingTagName.value = ''
  }

  // Confirm deletion
  const confirmDelete = () => {
    const { tagType, tag } = contextMenu.value
    const nameField = tagType === 'eventTypes' ? 'type' : 'name'
    const name = tag[nameField]

    const count = tagCounts.value[tagType]?.[name] || 0
    deleteMessageName.value = name
    deleteMessageCount.value = count

    tagToDelete.value = { type: tagType, id: tag.id, name }
    closeContextMenu()
    showDeleteConfirm.value = true
  }

  // Delete tag
  const deleteTagConfirmed = async () => {
    if (!tagToDelete.value) return

    try {
      await deleteTag(tagToDelete.value.type, tagToDelete.value.id, tagToDelete.value.name)
      showDeleteConfirm.value = false
      tagToDelete.value = null
    } catch (error) {
      console.error('deleteTagConfirmed error:', error)
      addNotification('error', error.message || t('tag.deleteError'))
    }
  }
</script>
