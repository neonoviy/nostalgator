<template>
  <div class="settings-modal__layout">
    <div class="settings-modal__content">
      <div class="mb-md">
        <label>{{ $t('scan.selectFolders', 'Select folders') }}</label>
        <FolderTreeSelect
          v-if="folderTree"
          v-model="selectedFolders"
          :tree="folderTree"
          :placeholder="$t('common.all')"
        />
        <div v-else-if="folderTreeError" class="settings-modal__loading settings-modal__error">
          {{ folderTreeError }}
        </div>
        <div v-else class="settings-modal__loading">
          {{ $t('scan.loadingTree', 'Loading...') }}
        </div>
      </div>

      <template v-if="scanState.firstLaunch.value && !scanState.isScanning.value">
        <p>
          <strong>{{ $t('scan.startWithFolderScan') }}</strong> 👇
        </p>
      </template>
      <template v-else>
        <div class="mb-md">
          <AppCheckbox
            v-if="scanState.autodetectFacesEnabled.value"
            v-model="forceFaces"
            :disabled="!showStartButton"
          >
            {{ $t('scan.forceFaces') }}
          </AppCheckbox>
          <AppCheckbox
            v-if="scanState.autodetectPlacesEnabled.value"
            v-model="forcePlaces"
            :disabled="!showStartButton"
          >
            {{ $t('scan.forcePlaces') }}
          </AppCheckbox>
          <AppCheckbox v-model="forceThumbs" :disabled="!showStartButton">
            {{ $t('scan.forceThumbs') }}
          </AppCheckbox>
        </div>
      </template>

      <div class="d-flex">
        <AppButton
          variant="primary"
          :saving="scanState.isScanning.value"
          :disabled="scanState.isScanning.value"
          @click="startScan"
          class="mr-sm"
        >
          {{ scanState.isScanning.value ? $t('scan.scanning') : $t('scan.fullScan') }}
        </AppButton>
        <AppButton v-if="scanState.isScanning.value" variant="danger" @click="handleCancel">
          {{ $t('common.cancel') }}
        </AppButton>
      </div>
    </div>
    <div class="settings-modal__content">
      <div class="mb-md">
        <div v-if="groups.length === 0" class="no-groups pt-lg">
          {{ $t('visibility.noGroups') }}
        </div>
        <div v-else>
          <label>{{ $t('scan.defaultVisibility') }}</label>
          <VueSelect
            v-model="selectedGroupIds"
            :options="groupOptions"
            :reduce="(option) => option.value"
            :multiple="true"
            :clearable="true"
            :placeholder="$t('visibility.everyone')"
            append-to-body
            :calculate-position="calculatePosition"
          />
        </div>
      </div>

      <div class="watch-section">
        <label>{{ $t('scan.watchOriginals') }}</label>
        <AppCheckbox
          :model-value="scanState.watchEnabled.value"
          @change="scanState.toggleWatch()"
          :disabled="scanState.isScanning.value"
        >
          {{ $t('scan.watchLabel') }}
        </AppCheckbox>
        <AppCheckbox
          :model-value="scanState.importWatchEnabled.value"
          @change="scanState.toggleImportWatch()"
          :disabled="!scanState.watchEnabled.value || scanState.isScanning.value"
        >
          {{ $t('scan.import') }}
        </AppCheckbox>
        <small v-if="scanState.importWatchEnabled.value" class="form-hint">
          {{ $t('scan.importWatchHint') }}
        </small>
      </div>
    </div>

    <div class="settings-modal__content">
      <div class="mb-md">
        <label>{{ $t('scan.language') }}</label>
        <LanguageSwitcher />
      </div>
      <div>
        <label>{{ $t('scan.theme') }}</label>
        <DarkmodeMenu />
      </div>
    </div>
  </div>
  <div class="settings-modal__layout">
    <div class="settings-modal__content pt-md">
      <div class="settings-modal__stat">
        <div class="stat">
          <h1>{{ scanState.stats.value.events }}</h1>
          <h2>{{ pluralizeStats('events', scanState.stats.value.events) }}</h2>
          <small
            >{{ scanState.stats.value.media }}
            {{ pluralizeStats('media', scanState.stats.value.media) }}</small
          >
        </div>
        <div class="stat">
          <h1>{{ scanState.stats.value.places }}</h1>
          <h2>{{ pluralizeStats('places', scanState.stats.value.places) }}</h2>
          <small
            >{{ scanState.stats.value.clusters }}
            {{ pluralizeStats('clusters', scanState.stats.value.clusters) }}
            <sup v-tooltip="$t('scan.clusterTooltip')">?</sup></small
          >
        </div>
        <div class="stat">
          <h1>{{ scanState.stats.value.persons }}</h1>
          <h2>{{ pluralizeStats('persons', scanState.stats.value.persons) }}</h2>
          <small
            >{{ $t('common.and') }} {{ scanState.stats.value.faces }}
            {{ pluralizeStats('faces', scanState.stats.value.faces) }}</small
          >
        </div>
      </div>
    </div>
    <div class="settings-modal__about pt-md">
      <h1>{{ $t('sidebar.aboutTitle') }}</h1>
      <small>v {{ APP_VERSION }}</small>
      <span class="mb-xs d-block">
        {{ $t('sidebar.aboutAuthor') }}
        <a href="https://dyranov.ru" target="_blank">{{ $t('sidebar.authorName') }}</a></span
      >
      <a href="https://dalink.to/dyranov" target="_blank">{{ $t('sidebar.donateLink') }}</a>
    </div>
  </div>
</template>

<script setup>
  import { ref, computed, inject, onMounted, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppButton from '../ui/AppButton.vue'
  import AppCheckbox from '../ui/AppCheckbox.vue'
  import FolderTreeSelect from '../ui/FolderTree/FolderTreeSelect.vue'
  import DarkmodeMenu from '../ui/DarkmodeMenu.vue'
  import LanguageSwitcher from '../ui/LanguageSwitcher.vue'
  import { calculatePosition } from '@/composables/useVueSelectPosition'
  import { usePluralize } from '@/composables/usePluralize'
  import { APP_VERSION } from '@/config.js'
  import VueSelect from 'vue-select'
  import 'vue-select/dist/vue-select.css'

  const { t } = useI18n()

  const emit = defineEmits(['close'])

  const props = defineProps({
    preSelectedFolder: {
      type: String,
      default: null,
    },
    preSelectedFolders: {
      type: Array,
      default: () => [],
    },
  })

  const scanState = inject('scanContext')

  const { pluralize } = usePluralize()

  const pluralizeStats = (key, count) => {
    const form = pluralize(count, {
      one: `scan.stats.${key}_one`,
      few: `scan.stats.${key}_few`,
      many: `scan.stats.${key}_many`,
      other: `scan.stats.${key}_other`,
    })
    return t(form, { count })
  }

  const selectedFolders = ref([])
  const folderTree = ref(null)
  const folderTreeError = ref(null)

  watch(
    () => [props.preSelectedFolder, props.preSelectedFolders],
    ([folder, folders]) => {
      if (folders && folders.length) {
        selectedFolders.value = [...folders]
      } else if (folder) {
        selectedFolders.value = [folder]
      }
    },
    { immediate: true },
  )

  const forceFaces = ref(scanState?.forceFaces?.value ?? false)
  const forcePlaces = ref(scanState?.forcePlaces?.value ?? false)
  const forceThumbs = ref(scanState?.forceThumbs?.value ?? false)

  const selectedGroupIds = ref(
    Array.isArray(scanState?.scanAllowedGroupIds?.value)
      ? [...scanState.scanAllowedGroupIds.value]
      : [],
  )
  const groups = ref([])
  let isInternalUpdate = false
  let initialized = false

  onMounted(() => {
    folderTree.value = null
    folderTreeError.value = null
    loadFolderTree()
    loadGroups()
    initialized = true
    scanState.loadStats()
  })

  watch(selectedGroupIds, async () => {
    if (!initialized) return
    isInternalUpdate = true
    await saveVisibilitySettings()
    isInternalUpdate = false
  })

  const showStartButton = computed(() => !scanState?.isScanning.value)

  const groupOptions = computed(() => {
    return groups.value.map((g) => ({ value: g.id, label: g.name }))
  })

  // Scan config: load the folder tree for folder selection
  async function loadFolderTree() {
    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch('/api/scan/folders', {
        headers: {
          Authorization: authToken ? `Bearer ${authToken}` : '',
          'Cache-Control': 'no-cache',
        },
      })
      if (!response.ok) throw new Error(t('scan.error.loadFolders', { status: response.status }))
      const result = await response.json()
      folderTree.value = result.data || result
    } catch (error) {
      console.error('Failed to load folder tree:', error)
      folderTreeError.value = error.message
    }
  }

  async function loadGroups() {
    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch('/api/groups?includeDeleted=false', {
        headers: {
          Authorization: authToken ? `Bearer ${authToken}` : '',
        },
      })
      if (!response.ok) return
      const result = await response.json()
      const data = result.success ? result.data : result
      if (Array.isArray(data)) {
        groups.value = data
      }
    } catch (error) {
      console.error('Failed to load groups:', error)
    }
  }

  // Scan config: start a full scan with force options
  const startScan = () => {
    scanState.startFullScan(
      selectedFolders.value,
      forceFaces.value,
      forcePlaces.value,
      forceThumbs.value,
    )
  }

  const handleCancel = () => {
    scanState.cancelScan()
  }

  // Visibility settings: persist allowed groups for new scans
  const saveVisibilitySettings = async () => {
    try {
      const authToken = localStorage.getItem('auth_token')
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify({
          scanAllowedGroupIds: selectedGroupIds.value,
        }),
      })
      if (!response.ok) throw new Error(t('scan.error.saveVisibility', { status: response.status }))
      const result = await response.json()
      const data = result.success ? result.data : result
      if (data.settings) {
        if (scanState.scanAllowedGroupIds)
          scanState.scanAllowedGroupIds.value = data.settings.scanAllowedGroupIds
      }
    } catch (error) {
      console.error('Failed to save visibility settings:', error)
    }
  }
</script>
