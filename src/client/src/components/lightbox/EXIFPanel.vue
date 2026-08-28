<template>
  <Teleport v-if="isSidebarReady" to=".fancybox__sidebar">
    <div class="lightbox-sidebar">
      <div class="sidebar-header">
        <h4 v-if="fullPath">{{ fullPath }}</h4>
      </div>

      <!-- Main information -->
      <div class="file-info">
        <div v-if="exif?.imageWidth" class="info-row">
          <span class="label">{{ $t('exif.dimensions') }}</span>
          <span class="value">{{ exif.imageWidth }} × {{ exif.imageHeight }}</span>
        </div>
        <div v-if="exif?.fileSize" class="info-row">
          <span class="label">{{ $t('exif.fileSize') }}</span>
          <span class="value">{{ formatFileSize(exif.fileSize) }}</span>
        </div>

        <div v-if="exif?.fileCreated" class="info-row">
          <span class="label">{{ $t('exif.created') }}</span>
          <span class="value">{{ formatDate(exif.fileCreated) }}</span>
        </div>
        <div v-if="exif?.fileModified" class="info-row">
          <span class="label">{{ $t('exif.modified') }}</span>
          <span class="value">{{ formatDate(exif.fileModified) }}</span>
        </div>
      </div>

      <!-- EXIF -->
      <div v-if="loading" class="loading">
        <span>{{ $t('exif.loading') }}</span>
      </div>
      <div v-else-if="error" class="error">
        <span>{{ error }}</span>
      </div>
      <div v-else-if="exif" class="exif-data">
        <div v-if="exif.camera || exif.lens">
          <h4 class="section-title">{{ $t('exif.cameraSection') }}</h4>
          <div v-if="exif.camera" class="info-row">
            <span class="label">{{ $t('exif.camera') }}</span>
            <span class="value">{{ exif.camera }}</span>
          </div>
          <div v-if="exif.lens" class="info-row">
            <span class="label">{{ $t('exif.lens') }}</span>
            <span class="value">{{ exif.lens }}</span>
          </div>
        </div>

        <div
          v-if="
            exif.exposure ||
            exif.aperture ||
            exif.iso ||
            exif.focalLength ||
            exif.exposureProgram ||
            exif.meteringMode ||
            exif.flash
          "
        >
          <h4 class="section-title">{{ $t('exif.settingsSection') }}</h4>
          <div v-if="exif.exposure" class="info-row">
            <span class="label">{{ $t('exif.exposure') }}</span>
            <span class="value">{{ formatExposure(exif.exposure) }} {{ $t('exif.seconds') }}</span>
          </div>
          <div v-if="exif.aperture" class="info-row">
            <span class="label">{{ $t('exif.aperture') }}</span>
            <span class="value">f/{{ exif.aperture }}</span>
          </div>
          <div v-if="exif.iso" class="info-row">
            <span class="label">{{ $t('exif.iso') }}</span>
            <span class="value">{{ exif.iso }}</span>
          </div>
          <div v-if="exif.focalLength" class="info-row">
            <span class="label">{{ $t('exif.focalLength') }}</span>
            <span class="value">{{ exif.focalLength }} {{ $t('exif.mm') }}</span>
          </div>
          <div v-if="exif.exposureProgram" class="info-row">
            <span class="label">{{ $t('exif.exposureProgram') }}</span>
            <span class="value">{{ formatExposureProgram(exif.exposureProgram) }}</span>
          </div>
          <div v-if="exif.meteringMode" class="info-row">
            <span class="label">{{ $t('exif.meteringMode') }}</span>
            <span class="value">{{ formatMeteringMode(exif.meteringMode) }}</span>
          </div>
          <div v-if="exif.flash" class="info-row">
            <span class="label">{{ $t('exif.flash') }}</span>
            <span class="value">{{ formatFlash(exif.flash) }}</span>
          </div>
        </div>

        <div v-if="exif.dateTime || exif.dateTimeDigitized || exif.dateTimeModified">
          <h4 class="section-title">{{ $t('exif.datetimeSection') }}</h4>
          <div v-if="exif.dateTime" class="info-row">
            <span class="label">{{ $t('exif.dateTime') }}</span>
            <span v-if="!editingDateTime" class="value">
              {{ formatDate(exif.dateTime) }}
              <AppButton
                v-if="isAdmin && !isReadonly"
                icon-only
                size="sm"
                variant="secondary"
                @click="startEditDateTime"
              >
                <template #icon>✏️</template>
              </AppButton>
            </span>
            <div v-else class="edit-form">
              <VueDatePicker
                v-model="editDateTimeValue"
                :locale="dpLocale"
                enable-time-picker
                auto-apply
                :clearable="false"
                placeholder=" "
              />
              <div class="edit-actions">
                <AppButton size="sm" variant="primary" @click="saveDateTime">✓</AppButton>
                <AppButton size="sm" variant="secondary" @click="cancelEditDateTime">×</AppButton>
              </div>
            </div>
          </div>
          <div v-if="exif.dateTimeDigitized" class="info-row">
            <span class="label">{{ $t('exif.dateTimeDigitized') }}</span>
            <span class="value">{{ formatDate(exif.dateTimeDigitized) }}</span>
          </div>
          <div v-if="exif.dateTimeModified" class="info-row">
            <span class="label">{{ $t('exif.dateTimeModified') }}</span>
            <span class="value">{{ formatDate(exif.dateTimeModified) }}</span>
          </div>
        </div>

        <div v-if="exif.gps || exif.gpsAltitude" class="gps-data">
          <h4 class="section-title">{{ $t('exif.gpsSection') }}</h4>
          <div v-if="exif.gpsLatitude && exif.gpsLongitude" class="exif-map-wrapper">
            <Map :location="{ lat: exif.gpsLatitude, lng: exif.gpsLongitude }" />
          </div>
          <div v-if="exif.gps" class="info-row">
            <span class="label">{{ $t('exif.gps') }}</span>
            <span v-if="!editingGps" class="value">
              {{ exif.gps }}
              <AppButton
                v-if="isAdmin && !isReadonly"
                icon-only
                size="sm"
                variant="secondary"
                @click="startEditGps"
              >
                <template #icon>✏️</template>
              </AppButton>
            </span>
            <div v-else class="edit-form">
              <div class="edit-coords">
                <input
                  v-model="editLat"
                  type="number"
                  step="any"
                  class="edit-input"
                  placeholder="Lat"
                />
                <input
                  v-model="editLng"
                  type="number"
                  step="any"
                  class="edit-input"
                  placeholder="Lng"
                />
              </div>
              <div class="edit-actions">
                <AppButton size="sm" variant="primary" @click="saveGps">✓</AppButton>
                <AppButton size="sm" variant="secondary" @click="cancelEditGps">×</AppButton>
              </div>
            </div>
          </div>
          <div v-if="exif.gpsAltitude" class="info-row">
            <span class="label">{{ $t('exif.gpsAltitude') }}</span>
            <span class="value">{{ exif.gpsAltitude }} {{ $t('exif.meters') }}</span>
          </div>
        </div>

        <div v-if="exif.artist || exif.copyright || exif.software">
          <h4 class="section-title">{{ $t('exif.authorshipSection') }}</h4>
          <div v-if="exif.artist" class="info-row">
            <span class="label">{{ $t('exif.artist') }}</span>
            <span class="value">{{ exif.artist }}</span>
          </div>
          <div v-if="exif.copyright" class="info-row">
            <span class="label">{{ $t('exif.copyright') }}</span>
            <span class="value">{{ exif.copyright }}</span>
          </div>
          <div v-if="exif.software" class="info-row">
            <span class="label">{{ $t('exif.software') }}</span>
            <span class="value">{{ exif.software }}</span>
          </div>
        </div>
      </div>
      <div v-else class="no-exif">
        <span>{{ $t('exif.noData') }}</span>
      </div>

      <div v-if="isAdmin && !isReadonly && mediaId" class="delete-media-section">
        <button class="delete-media-button" :disabled="deleting" @click="deleteMedia">
          {{ deleting ? t('media.deleting') : t('media.delete') }}
        </button>
      </div>

      <Modal
        v-model="showDeleteConfirm"
        :title="$t('media.delete')"
        type="confirm"
        :confirm-text="$t('common.delete')"
        confirm-class="danger"
        teleport-to=".fancybox__sidebar"
        @confirm="confirmDelete"
      >
        <p>{{ t('media.deleteConfirm', { filename: filename }) }}</p>
      </Modal>
    </div>
  </Teleport>
</template>

<script setup>
  import { ref, watch, inject, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import Map from '../map.vue'
  import Modal from '../ui/Modal.vue'
  import AppButton from '../ui/AppButton.vue'
  import { VueDatePicker } from '@vuepic/vue-datepicker'
  import '@vuepic/vue-datepicker/dist/main.css'
  import { ru as dateRu, enUS as dateEn } from 'date-fns/locale'
  import { useReadonly } from '../../composables/useReadonly'
  import { Fancybox } from '@fancyapps/ui'

  const { t, locale } = useI18n()
  const exifSidebar = inject('exifSidebar')
  const auth = inject('authContext')
  const { isAdmin } = auth
  const { isReadonly } = useReadonly()

  const props = defineProps({
    src: String, // Image URL
    mediaId: { type: Number, default: null },
  })

  const exif = ref(null)
  const loading = ref(false)
  const error = ref('')
  const filename = ref('')
  const fullPath = ref('')
  const faces = ref([])
  const isSidebarReady = ref(false)
  const deleting = ref(false)
  const showDeleteConfirm = ref(false)
  const editingGps = ref(false)
  const editingDateTime = ref(false)
  const editLat = ref('')
  const editLng = ref('')
  const editDateTimeValue = ref('')

  const confirmDelete = async () => {
    if (!props.mediaId || deleting.value) return
    deleting.value = true
    try {
      const token = auth.token?.value
      const response = await fetch(`/api/media/${props.mediaId}`, {
        method: 'DELETE',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || t('media.error.deleteFailed'))
      }

      window.dispatchEvent(new CustomEvent('media-deleted', { detail: { mediaId: props.mediaId } }))

      Fancybox.close()
    } catch (e) {
      console.error('Failed to delete media:', e)
      window.alert(e.message || t('media.error.deleteFailed'))
    } finally {
      deleting.value = false
    }
  }

  const deleteMedia = () => {
    if (!props.mediaId || deleting.value) return
    showDeleteConfirm.value = true
  }

  const startEditGps = () => {
    if (!exif.value) return
    editLat.value = String(exif.value.gpsLatitude ?? '')
    editLng.value = String(exif.value.gpsLongitude ?? '')
    editingGps.value = true
  }

  const cancelEditGps = () => {
    editingGps.value = false
    editLat.value = ''
    editLng.value = ''
  }

  const saveGps = async () => {
    if (!props.mediaId || !exif.value) return
    try {
      const token = auth.token?.value
      const url = new URL(props.src, window.location.origin)
      const parts = url.pathname.split('/originals/')
      if (parts.length < 2) return
      const pathParts = parts[1].split('/')
      const year = decodeURIComponent(pathParts[0])
      const event = encodeURIComponent(decodeURIComponent(pathParts[1]))
      const encodedFilename = encodeURIComponent(decodeURIComponent(pathParts[2]))

      const response = await fetch(
        `/api/originals/${year}/${event}/${encodedFilename}/exif`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({
            latitude: editLat.value,
            longitude: editLng.value,
          }),
        },
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save GPS')
      }

      const responseData = await response.json()
      const data = responseData.success ? responseData.data : responseData
      if (data.hasExif) {
        exif.value = data.data
      }
      editingGps.value = false
      if (exifSidebar?.reloadClusters) {
        exifSidebar.reloadClusters()
      }
    } catch (e) {
      console.error('Failed to save GPS:', e)
    }
  }

  const startEditDateTime = () => {
    if (!exif.value || !exif.value.dateTime) return
    const dateStr = exif.value.dateTime
    const raw = typeof dateStr === 'object' && dateStr.rawValue ? String(dateStr.rawValue) : String(dateStr)
    const iso = raw.replace(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6')
    if (iso) {
      editDateTimeValue.value = iso
      editingDateTime.value = true
    }
  }

  const cancelEditDateTime = () => {
    editingDateTime.value = false
    editDateTimeValue.value = ''
  }

  const saveDateTime = async () => {
    if (!props.mediaId || !exif.value) return
    try {
      const token = auth.token?.value
      const url = new URL(props.src, window.location.origin)
      const parts = url.pathname.split('/originals/')
      if (parts.length < 2) return
      const pathParts = parts[1].split('/')
      const year = decodeURIComponent(pathParts[0])
      const event = encodeURIComponent(decodeURIComponent(pathParts[1]))
      const encodedFilename = encodeURIComponent(decodeURIComponent(pathParts[2]))

      const response = await fetch(
        `/api/originals/${year}/${event}/${encodedFilename}/exif`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({
            dateTime: editDateTimeValue.value,
          }),
        },
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save date/time')
      }

      const responseData = await response.json()
      const data = responseData.success ? responseData.data : responseData
      if (data.hasExif) {
        exif.value = data.data
      }
      editingDateTime.value = false
      if (exifSidebar?.reloadClusters) {
        exifSidebar.reloadClusters()
      }
    } catch (e) {
      console.error('Failed to save date/time:', e)
    }
  }

  const onSidebarReady = () => {
    isSidebarReady.value = true
  }

  const onSidebarNotReady = () => {
    isSidebarReady.value = false
  }

  onMounted(() => {
    isSidebarReady.value = !!document.querySelector('.fancybox__sidebar')
    window.addEventListener('fancybox:opened', onSidebarReady)
    window.addEventListener('fancybox:closed', onSidebarNotReady)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('fancybox:opened', onSidebarReady)
    window.removeEventListener('fancybox:closed', onSidebarNotReady)
  })

  const loadExif = async (src) => {
    loading.value = true
    error.value = ''
    exif.value = null

    try {
      // Extract path from URL
      const url = new URL(src, window.location.origin)
      const parts = url.pathname.split('/originals/')
      if (parts.length < 2) throw new Error(t('exif.invalidUrl'))

      const pathParts = parts[1].split('/')
      const year = pathParts[0]
      const event = decodeURIComponent(pathParts[1])
      const file = decodeURIComponent(pathParts[2])

      if (!year || !event || !file) {
        throw new Error(t('exif.invalidPath'))
      }

      filename.value = file
      fullPath.value = `${year}/${event}/${file}`

      // Use decoded values directly
      const response = await fetch(
        `/api/originals/${year}/${encodeURIComponent(event)}/${encodeURIComponent(file)}/exif`,
      )
      const responseData = await response.json()
      const data = responseData.success ? responseData.data : responseData

      if (data.hasExif) {
        exif.value = data.data
      }
    } catch (e) {
      console.error('Failed to load EXIF:', e)
      error.value = t('exif.error')
    } finally {
      loading.value = false
    }
  }

  const loadFaces = async () => {
    if (!props.mediaId) {
      faces.value = []
      if (exifSidebar?.setOverlayFaces) {
        exifSidebar.setOverlayFaces([])
      }
      return
    }
    if (exifSidebar?.setOverlayFaces) {
      exifSidebar.setOverlayFaces([])
    }
    try {
      const res = await fetch(`/api/media/${props.mediaId}/faces`)
      if (!res.ok) {
        faces.value = []
        return
      }
      const data = await res.json()
      const list = data.success ? data.data?.faces || data.data || [] : data.faces || []
      faces.value = list
    } catch (e) {
      faces.value = []
    }
    nextTick(() => {
      if (exifSidebar?.setOverlayFaces) {
        exifSidebar.setOverlayFaces(faces.value)
      }
    })
  }

  watch(
    () => props.src,
    (newSrc) => {
      if (newSrc) {
        loadExif(newSrc)
        loadFaces()
      }
    },
    { immediate: true },
  )

  watch(
    () => props.mediaId,
    (newMediaId) => {
      loadFaces()
      if (exifSidebar?.setOverlayMediaId) {
        exifSidebar.setOverlayMediaId(newMediaId)
      }
    },
  )

  const dpLocale = computed(() => {
    return locale.value === 'ru' ? dateRu : dateEn
  })

  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    // exiftool-vendored returns size as a string like "2.5 MB" or as a number
    if (typeof bytes === 'string') return bytes

    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }

  const formatDate = (date) => {
    if (!date) return ''

    // exiftool-vendored returns an ExifDateTime object with rawValue
    if (typeof date === 'object' && date.rawValue) {
      date = date.rawValue
    }

    // exiftool may return date as a string "YYYY:MM:DD HH:MM:SS" or as a Date object
    if (date instanceof Date) {
      const langCode = locale.value === 'ru' ? 'ru-RU' : 'en-US'
      return date.toLocaleString(langCode)
    }

    // If string, convert format "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
    const dateStr = String(date)
    // Replace YYYY:MM:DD HH:MM:SS → YYYY-MM-DDTHH:MM:SS (ISO format)
    const isoFormat = dateStr.replace(
      /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/,
      '$1-$2-$3T$4:$5:$6',
    )
    const d = new Date(isoFormat)
    const langCode = locale.value === 'ru' ? 'ru-RU' : 'en-US'
    return isNaN(d.getTime()) ? '' : d.toLocaleString(langCode)
  }

  const formatExposure = (exposure) => {
    if (!exposure) return ''
    // Format exposure (e.g., 1/1000)
    if (typeof exposure === 'number') {
      if (exposure < 1) {
        return `1/${Math.round(1 / exposure)}`
      }
      return exposure.toString()
    }
    return exposure
  }

  const formatExposureProgram = (program) => {
    if (typeof program === 'string' && isNaN(Number(program))) {
      return program
    }
    const programs = {
      0: t('exif.exposurePrograms.0'),
      1: t('exif.exposurePrograms.1'),
      2: t('exif.exposurePrograms.2'),
      3: t('exif.exposurePrograms.3'),
      4: t('exif.exposurePrograms.4'),
      5: t('exif.exposurePrograms.5'),
      6: t('exif.exposurePrograms.6'),
      7: t('exif.exposurePrograms.7'),
      8: t('exif.exposurePrograms.8'),
    }
    const num = Number(program)
    return programs[num] || String(program)
  }

  const formatMeteringMode = (mode) => {
    if (typeof mode === 'string' && isNaN(Number(mode))) {
      return mode
    }
    const modes = {
      0: t('exif.meteringModes.0'),
      1: t('exif.meteringModes.1'),
      2: t('exif.meteringModes.2'),
      3: t('exif.meteringModes.3'),
      4: t('exif.meteringModes.4'),
      5: t('exif.meteringModes.5'),
      6: t('exif.meteringModes.6'),
      255: t('exif.meteringModes.255'),
    }
    const num = Number(mode)
    return modes[num] || String(mode)
  }

  const formatFlash = (flash) => {
    if (typeof flash === 'string' && isNaN(Number(flash))) {
      return flash
    }
    if (typeof flash === 'number') {
      const flags = {
        0: t('exif.flashModes.0'),
        1: t('exif.flashModes.1'),
        5: t('exif.flashModes.5'),
        7: t('exif.flashModes.7'),
        9: t('exif.flashModes.9'),
        13: t('exif.flashModes.13'),
        15: t('exif.flashModes.15'),
        16: t('exif.flashModes.16'),
        24: t('exif.flashModes.24'),
        25: t('exif.flashModes.25'),
        29: t('exif.flashModes.29'),
        31: t('exif.flashModes.31'),
        65: t('exif.flashModes.65'),
        127: t('exif.flashModes.127'),
      }
      const num = Number(flash)
      return flags[num] || String(flash)
    }
    return String(flash)
  }
</script>

<style scoped lang="scss">
  .exif-map-wrapper {
    height: 250px;
    margin-top: 12px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    position: relative;
  }
</style>
