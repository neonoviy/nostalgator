<template>
  <SideOverlay
    :model-value="modelValue"
    :title="title"
    :content-class="shakeClass"
    :close-on-click-outside="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @close="$emit('close')"
  >
    <div class="event-edit-modal">
      <form>
        <!-- Folder path (admin only and on error) -->
        <div v-if="isAdmin && pathError" class="form-group">
          <label for="folderPath">{{ $t('event.originalsPath') }}</label>
          <input
            ref="folderPathInput"
            id="folderPath"
            v-model="formData.folderPath"
            type="text"
            :placeholder="$t('event.enterFolderPath')"
            :class="{ 'input-error': pathError }"
            @input="onFolderPathInput"
            @keydown="onFolderPathKeydown"
          />
          <div v-if="pathError" class="form-error">{{ pathError }}</div>
          <small class="form-hint">{{ $t('event.pathFormat') }}</small>
        </div>

        <div class="form-group">
          <label for="title">{{ $t('event.folderName') }}</label>
          <input
            ref="titleInput"
            id="title"
            class="form-input"
            v-model="formData.title"
            type="text"
            :placeholder="$t('event.enterFolderName')"
            :class="{ 'input-error': titleError }"
            @input="validateTitle"
          />
          <div v-if="titleError" class="form-error">{{ titleError }}</div>
          <small class="form-hint">{{ $t('event.nameFormat') }}</small>
        </div>

        <div class="form-group">
          <label for="eventDate">{{ $t('event.date') }}</label>
          <VueDatePicker
            id="eventDate"
            v-model="formData.eventDate"
            :locale="dpLocale"
            :min-date="minDate"
            :max-date="maxDate"
            disable-year-select
            :time-config="{ enableTimePicker: false }"
            :vertical="true"
            auto-apply
            :clearable="true"
            :placeholder="$t('event.selectDate')"
            :class="{ 'input-error': dateError }"
          >
            <template #input-icon> </template>
          </VueDatePicker>
          <small class="form-hint">{{ $t('event.folderNameHint') }}</small>
        </div>

        <!-- Tags -->
        <div class="form-group">
          <label for="participants">{{ $t('event.participants') }}</label>
          <VueSelect
            id="participants"
            v-model="participantModel"
            :options="participantOptions"
            :no-drop="!participantOptions.length"
            multiple
            taggable
            :create-option="(label) => ({ label, value: label })"
            :reduce="(option) => option.value"
            :placeholder="$t('event.enterParticipants')"
            append-to-body
            :calculate-position="calculatePosition"
          >
          </VueSelect>
        </div>

        <div class="form-group">
          <label for="places">{{ $t('event.places') }}</label>
          <VueSelect
            id="places"
            v-model="placeModel"
            :options="placeOptions"
            :no-drop="!placeOptions.length"
            multiple
            taggable
            :create-option="(label) => ({ label, value: label })"
            :reduce="(option) => option.value"
            :placeholder="$t('event.enterPlaces')"
            append-to-body
            :calculate-position="calculatePosition"
          />
        </div>

        <div class="form-group">
          <label for="eventTypes">{{ $t('event.eventTypes') }}</label>
          <VueSelect
            id="eventTypes"
            v-model="eventTypeModel"
            :options="eventTypeOptions"
            :no-drop="!eventTypeOptions.length"
            multiple
            taggable
            :create-option="(label) => ({ label, value: label })"
            :reduce="(option) => option.value"
            :placeholder="$t('event.enterEventTypes')"
            append-to-body
            :calculate-position="calculatePosition"
          />
        </div>

        <div class="form-group">
          <label for="tags">{{ $t('event.tags') }}</label>
          <VueSelect
            id="tags"
            v-model="tagModel"
            :options="tagOptions"
            :no-drop="!tagOptions.length"
            multiple
            taggable
            :create-option="(label) => ({ label, value: label })"
            :reduce="(option) => option.value"
            :placeholder="$t('event.enterTags')"
            append-to-body
            :calculate-position="calculatePosition"
          />
        </div>

        <!-- Group access (admin only) -->
        <div v-if="availableGroups.length != 0" class="access-section mb-md">
          <label>{{ $t('visibility.visibleTo') }}</label>
          <VueSelect
            v-model="formData.allowedGroupIds"
            :options="groupOptions"
            :reduce="(option) => option.value"
            :multiple="true"
            :clearable="true"
            :placeholder="$t('visibility.everyone')"
            append-to-body
            :calculate-position="calculatePosition"
          />
        </div>

        <div class="py-md">
          <AppButton
            v-if="isAdmin"
            type="button"
            @click="showDeleteConfirm = true"
            variant="danger"
            class="d-block w-100 mb-sm"
          >
            {{ $t('event.delete') }}
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            class="d-block w-100 mb-md"
            @click="openRescan"
            :disabled="!props.event?.folderPath"
          >
            {{ $t('scan.rescan') }}
          </AppButton>
        </div>
      </form>

      <!-- Delete confirmation dialog -->
      <Modal
        v-model="showDeleteConfirm"
        :title="$t('event.deleteConfirmTitle')"
        type="confirm"
        :confirm-text="$t('common.delete')"
        confirm-class="danger"
        @confirm="deleteEvent"
      >
        <p>{{ $t('event.deleteConfirmText', { title: formData.title }) }}</p>
        <p v-if="isReadonly">{{ $t('event.deleteWarning') }}</p>
        <p v-else-if="deleteOnlyFromDB">{{ $t('event.deleteWarning') }}</p>
        <p v-else>{{ $t('event.deleteWarningFull') }}</p>

        <AppCheckbox
          v-if="!isReadonly"
          v-model="deleteOnlyFromDB"
          :label="$t('event.deleteOnlyFromDB')"
        />
      </Modal>
    </div>

    <template #footer>
      <AppButton
        type="button"
        variant="primary"
        :disabled="!hasChanges || hasErrors || saving"
        :saving="saving"
        @click="save"
        class="d-block w-100"
      >
        {{ $t('common.save') }}
      </AppButton>
    </template>
  </SideOverlay>
</template>

<script setup>
  /* eslint-disable no-shadow */
  import { ref, watch, computed, inject } from 'vue'
  import { VueDatePicker } from '@vuepic/vue-datepicker'
  import '@vuepic/vue-datepicker/dist/main.css'
  import { useI18n } from 'vue-i18n'
  import { ru as dateRu, enUS as dateEn } from 'date-fns/locale'
  import Modal from '../ui/Modal.vue'
  import VueSelect from 'vue-select'
  import 'vue-select/dist/vue-select.css'
  import SideOverlay from '../ui/SideOverlay.vue'
  import AppButton from '../ui/AppButton.vue'
  import AppCheckbox from '../ui/AppCheckbox.vue'
  import { useReadonly } from '../../composables/useReadonly'
  import { calculatePosition } from '../../composables/useVueSelectPosition'

  // Auth from context (single source of truth)
  const auth = inject('authContext')
  const { isAdmin, token } = auth

  const settingsModal = inject('settingsModalContext')

  const { isReadonly } = useReadonly()

  // i18n
  const { locale, t } = useI18n()

  // Locale for VueDatePicker (dynamically depends on selected language)
  const dpLocale = computed(() => {
    return locale.value === 'ru' ? dateRu : dateEn
  })

  // Get tags from filterContext
  const { places, eventTypes, people, tags } = inject('filterContext')

  const props = defineProps({
    modelValue: {
      type: Boolean,
      default: false,
    },
    event: {
      type: Object,
      default: null,
    },
    saving: {
      type: Boolean,
      default: false,
    },
    saveResetKey: {
      type: Number,
      default: 0,
    },
  })

  const emit = defineEmits(['save', 'close', 'delete', 'update:modelValue'])

  const shakeClass = ref('')

  const triggerShake = () => {
    shakeClass.value = 'shake'
    setTimeout(() => {
      shakeClass.value = ''
    }, 500)
  }

  const title = computed(() => {
    return props.event ? t('app.editEventWithTitle', { id: props.event.id }) : t('app.editEvent')
  })

  const folderPathInput = ref(null)
  const titleInput = ref(null)

  const formData = ref({
    id: null,
    folderPath: '',
    title: '',
    eventDate: '', // YYYY-MM-DD for input type="date"
    places: '',
    eventTypes: '',
    participants: '',
    tags: '',
    allowedGroupIds: [],
  })

  // Original data for comparison
  const originalData = ref({
    folderPath: '',
    title: '',
    eventDate: '',
    places: '',
    eventTypes: '',
    participants: '',
    tags: '',
    allowedGroupIds: [],
  })

  /**
   * Normalize tag array to string for the form
   * Handles: array → join, string → as-is, object with nested field → fallback, null → ''
   * @param {Array|string|object|null} value - tag value
   * @param {string} nestedKey - nested object key (e.g. 'tags' for EventTag)
   * @returns {string}
   */
  const normalizeTagField = (value, nestedKey = '') => {
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && nestedKey) {
      return Array.isArray(value[nestedKey]) ? value[nestedKey].join(', ') : ''
    }
    return ''
  }

  // Errors
  const pathError = ref('')
  const titleError = ref('')
  const dateError = ref('')
  const showDeleteConfirm = ref(false)
  const deleteOnlyFromDB = ref(false)

  // Invalid characters for Windows file names
  const INVALID_CHARS_REGEX = /[<>:"/\\|？*]/g

  // Path input handling
  const onFolderPathInput = (e) => {
    const value = e.target.value
    const invalidMatch = value.match(INVALID_CHARS_REGEX)

    if (invalidMatch) {
      // Remove invalid characters
      const cleanValue = value.replace(INVALID_CHARS_REGEX, '')
      formData.value.folderPath = cleanValue

      // Trigger shake
      triggerShake()
    }
  }

  // Path keydown handling
  const onFolderPathKeydown = (e) => {
    // Allow: letters, digits, /, ., space, backspace, delete, arrows
    const allowedKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'Tab',
      '/',
    ]

    if (allowedKeys.includes(e.key)) {
      return
    }

    // Block invalid characters
    if (/[<>:"\\|?*]/.test(e.key)) {
      e.preventDefault()
      triggerShake()
    }
  }

  // Helper: compares Date objects by value
  const datesEqual = (a, b) => {
    if (!a && !b) return true
    if (!a || !b) return false
    return a.getTime() === b.getTime()
  }

  // Check for changes
  const hasChanges = computed(() => {
    return (
      formData.value.folderPath !== originalData.value.folderPath ||
      formData.value.title !== originalData.value.title ||
      !datesEqual(formData.value.eventDate, originalData.value.eventDate) ||
      formData.value.places !== originalData.value.places ||
      formData.value.eventTypes !== originalData.value.eventTypes ||
      formData.value.participants !== originalData.value.participants ||
      formData.value.tags !== originalData.value.tags ||
      JSON.stringify(formData.value.allowedGroupIds) !==
        JSON.stringify(originalData.value.allowedGroupIds)
    )
  })

  // Access groups
  const availableGroups = ref([])

  const loadGroups = async () => {
    try {
      const res = await fetch('/api/groups?includeDeleted=false', {
        headers: { Authorization: token.value ? `Bearer ${token.value}` : '' },
      })
      if (res.ok) {
        const data = await res.json()
        availableGroups.value = data.success ? data.data : data
      }
    } catch (e) {
      console.error('Failed to load groups:', e)
    }
  }

  watch(
    [() => isAdmin.value, () => props.event],
    ([admin, event]) => {
      if (admin && event) loadGroups()
    },
    { immediate: true },
  )

  watch(
    () => props.saveResetKey,
    () => {
      const src = formData.value
      originalData.value = {
        id: src.id,
        folderPath: src.folderPath,
        title: src.title,
        eventDate:
          src.eventDate instanceof Date
            ? new Date(src.eventDate)
            : src.eventDate
              ? new Date(src.eventDate)
              : null,
        places: src.places,
        eventTypes: src.eventTypes,
        participants: src.participants,
        tags: src.tags,
        allowedGroupIds: src.allowedGroupIds ? [...src.allowedGroupIds] : [],
      }
    },
  )

  // Error check
  const hasErrors = computed(() => {
    return !!pathError.value || !!titleError.value || !!dateError.value
  })

  // Year from folder path
  const eventYear = computed(() => {
    const match = formData.value.folderPath.match(/^(\d{4})\//)
    return match ? parseInt(match[1]) : new Date().getFullYear()
  })

  // Min and max date (current year only)
  const minDate = computed(() => {
    return new Date(eventYear.value, 0, 1) // January 1st
  })

  const maxDate = computed(() => {
    return new Date(eventYear.value, 11, 31) // December 31st
  })

  const participantOptions = computed(() =>
    people.value.map((p) => ({ label: p.name, value: p.name })),
  )

  const placeOptions = computed(() => places.value.map((p) => ({ label: p.name, value: p.name })))

  const eventTypeOptions = computed(() =>
    eventTypes.value.map((et) => ({ label: et.type, value: et.type })),
  )

  const tagOptions = computed(() => tags.value.map((t) => ({ label: t.name, value: t.name })))

  const groupOptions = computed(() => {
    return availableGroups.value.map((g) => ({ value: g.id, label: g.name }))
  })

  const participantModel = computed({
    get: () =>
      formData.value.participants
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    set: (val) => {
      formData.value.participants = val.join(', ')
    },
  })

  const placeModel = computed({
    get: () =>
      formData.value.places
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    set: (val) => {
      formData.value.places = val.join(', ')
    },
  })

  const eventTypeModel = computed({
    get: () =>
      formData.value.eventTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    set: (val) => {
      formData.value.eventTypes = val.join(', ')
    },
  })

  const tagModel = computed({
    get: () =>
      formData.value.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    set: (val) => {
      formData.value.tags = val.join(', ')
    },
  })

  // Path validation
  const validatePath = () => {
    pathError.value = ''

    const newPath = formData.value.folderPath.trim()
    const originalPath = originalData.value.folderPath

    // If path unchanged — skip validation
    if (newPath === originalPath) {
      return
    }

    if (!newPath) {
      pathError.value = t('event.pathRequired')
      return
    }

    const pathRegex = /^\d{4}\/\d{2}\.\d{2}\s*.+/
    if (!pathRegex.test(newPath)) {
      pathError.value = t('event.pathInvalid')
      return
    }
  }

  // Title validation
  const validateTitle = () => {
    titleError.value = ''

    const newTitle = formData.value.title.trim()
    const originalTitle = originalData.value.title

    // If title unchanged — skip validation
    if (newTitle === originalTitle) {
      return
    }

    // Check for invalid characters
    if (INVALID_CHARS_REGEX.test(newTitle)) {
      titleError.value = t('event.nameInvalidChars')
      return
    }

    // Title cannot be empty
    if (!newTitle) {
      titleError.value = t('event.nameRequired')
      return
    }
  }

  // Form initialization
  watch(
    () => props.event,
    async (newEvent) => {
      if (newEvent) {
        // Extract year from folderPath
        const yearMatch = newEvent.folderPath?.match(/^(\d{4})\//)
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear()

        // Format date for DatePicker (Date object)
        let eventDateValue = null
        if (newEvent.date) {
          eventDateValue = new Date(newEvent.date)
        }

        formData.value = {
          id: newEvent.id,
          folderPath: newEvent.folderPath || '',
          title: newEvent.title || '',
          eventDate: eventDateValue,
          places: normalizeTagField(newEvent.places),
          eventTypes: normalizeTagField(newEvent.eventType),
          participants: normalizeTagField(newEvent.participants),
          tags: normalizeTagField(newEvent.tags, 'tags'),
          allowedGroupIds: Array.isArray(newEvent.allowedGroupIds)
            ? [...newEvent.allowedGroupIds]
            : [],
        }

        // Save original data
        originalData.value = {
          folderPath: newEvent.folderPath || '',
          title: newEvent.title || '',
          eventDate: eventDateValue,
          places: normalizeTagField(newEvent.places),
          eventTypes: normalizeTagField(newEvent.eventType),
          participants: normalizeTagField(newEvent.participants),
          tags: normalizeTagField(newEvent.tags, 'tags'),
          allowedGroupIds: Array.isArray(newEvent.allowedGroupIds)
            ? [...newEvent.allowedGroupIds]
            : [],
        }

        // Check folder existence (admin only)
        if (isAdmin.value && newEvent.folderPath) {
          try {
            const response = await fetch(`/api/events/${newEvent.id}/check-path`, {
              headers: {
                Authorization: token.value ? `Bearer ${token.value}` : '',
              },
            })
            const data = await response.json()
            const pathData = data.success ? data.data : data
            if (!pathData.exists) {
              pathError.value = t('event.folderNotFound')
            }
          } catch (e) {
            console.error('Path check failed:', e)
          }
        }
      }

      // Reset errors
      titleError.value = ''
      dateError.value = ''
    },
    { immediate: true },
  )

  const save = async () => {
    // Validate changed fields
    if (formData.value.folderPath !== originalData.value.folderPath) {
      validatePath()
      if (pathError.value) return
    }

    if (formData.value.title !== originalData.value.title) {
      validateTitle()
      if (titleError.value) return
    }

    // Collect only changed data
    const changes = {}

    if (formData.value.folderPath !== originalData.value.folderPath) {
      changes.folderPath = formData.value.folderPath
    }

    if (formData.value.title !== originalData.value.title) {
      changes.folderName = formData.value.title // ← Send as folderName
    }

    if (!datesEqual(formData.value.eventDate, originalData.value.eventDate)) {
      changes.eventDate = formData.value.eventDate // ← Send date
    }

    // Convert tags to arrays
    const placesArray =
      typeof formData.value.places === 'string'
        ? formData.value.places
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t)
        : formData.value.places || []

    const eventTypesArray =
      typeof formData.value.eventTypes === 'string'
        ? formData.value.eventTypes
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t)
        : formData.value.eventTypes || []

    const participantsArray =
      typeof formData.value.participants === 'string'
        ? formData.value.participants
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p)
        : formData.value.participants || []

    const tagsArray =
      typeof formData.value.tags === 'string'
        ? formData.value.tags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t)
        : formData.value.tags || []

    // Check tag changes
    const originalPlaces = originalData.value.places
    const newPlaces = placesArray.join(', ')
    if (newPlaces !== originalPlaces) {
      changes.places = placesArray
    }

    const originalEventTypes = originalData.value.eventTypes
    const newEventTypes = eventTypesArray.join(', ')
    if (newEventTypes !== originalEventTypes) {
      changes.eventTypes = eventTypesArray
    }

    const originalParticipants = originalData.value.participants
    const newParticipants = participantsArray.join(', ')
    if (newParticipants !== originalParticipants) {
      changes.participants = participantsArray
    }

    const originalTags = originalData.value.tags
    const newTags = tagsArray.join(', ')
    if (newTags !== originalTags) {
      changes.tags = tagsArray
    }

    // Visibility and groups
    if (
      JSON.stringify(formData.value.allowedGroupIds) !==
      JSON.stringify(originalData.value.allowedGroupIds)
    ) {
      changes.allowedGroupIds = [...formData.value.allowedGroupIds]
    }

    // If no changes — don't save
    if (Object.keys(changes).length === 0) {
      emit('close')
      emit('update:modelValue', false)
      return
    }

    emit('save', {
      id: formData.value.id,
      ...changes,
      onPathError: (error) => {
        pathError.value = error
      },
    })
  }

  const openRescan = () => {
    const folderPath = props.event?.folderPath
    if (!folderPath || !settingsModal) return
    emit('close')
    emit('update:modelValue', false)
    settingsModal.openSettingsModal('scan', { folders: [folderPath] })
  }

  const deleteEvent = () => {
    emit('delete', {
      id: formData.value.id,
      folderPath: formData.value.folderPath,
      deleteOriginals: !deleteOnlyFromDB.value,
    })
  }

  const cancel = () => {
    emit('close')
    emit('update:modelValue', false)
  }
</script>
