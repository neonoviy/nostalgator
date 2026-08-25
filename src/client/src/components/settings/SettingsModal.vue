<template>
  <Modal
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :title="$t('settings.title')"
    size="large"
    :close-on-click-outside="false"
    :keep-mounted="true"
  >
    <ButtonGroup v-model="activeTab" :options="tabOptions" class="settings-modal__tabs mb-md" />

    <div class="settings-modal__panels">
      <ScanSettingsTab
        v-if="activeTab === 'scan'"
        :pre-selected-folder="preSelectedFolder"
        @close="$emit('update:modelValue', false)"
      />
      <UsersTab
        v-else-if="activeTab === 'users'"
        :users="users"
        :groups="groups"
        :users-loading="usersLoading"
        :users-error="usersError"
        :refresh-users="refreshUsers"
      />
      <GroupsTab
        v-else-if="activeTab === 'groups'"
        :groups="groups"
        :all-users="allUsers"
        :groups-loading="groupsLoading"
        :groups-error="groupsError"
        :refresh-groups="refreshGroups"
      />
    </div>

    <div ref="logsContainer" :class="['scan-logs', showLogs ? 'is-open' : 'is-closed']">
      <div v-for="log in scanState.scanLogs.value" :key="log.ts" class="log-entry">
        {{ log.msg }}
      </div>
    </div>
    <div class="log-wrapper">
      <AppButton
        variant="secondary"
        size="sm"
        @click="toggleLogs"
        :class="showLogs ? 'unround-top' : ''"
      >
        {{ showLogs ? $t('scan.hideLog') : $t('scan.showLog') }}
      </AppButton>
    </div>
  </Modal>
</template>

<script setup>
  import { ref, watch, computed, inject, onMounted, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import Modal from '../ui/Modal.vue'
  import ButtonGroup from '../ui/ButtonGroup.vue'
  import AppButton from '../ui/AppButton.vue'
  import ScanSettingsTab from './ScanSettingsTab.vue'
  import UsersTab from './UsersTab.vue'
  import GroupsTab from './GroupsTab.vue'

  const props = defineProps({
    modelValue: {
      type: Boolean,
      default: false,
    },
    preSelectedFolder: {
      type: String,
      default: null,
    },
  })

  const emit = defineEmits(['update:modelValue'])

  const scanState = inject('scanContext')
  const auth = inject('authContext')
  const { token } = auth

  const { t } = useI18n()

  const activeTab = ref('scan')

  const SCAN_LOGS_COOKIE = 'scan_logs_visible'

  function getCookie(name) {
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) {
      return parts.pop().split(';').shift()
    }
    return null
  }

  function setCookie(name, value) {
    const maxAge = 31536000
    document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
  }

  const showLogs = ref(getCookie(SCAN_LOGS_COOKIE) === 'true')

  watch(showLogs, async (newVal) => {
    setCookie(SCAN_LOGS_COOKIE, newVal ? 'true' : 'false')
    if (newVal) {
      await nextTick()
      if (logsContainer.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight
      }
    }
  })

  function toggleLogs() {
    showLogs.value = !showLogs.value
  }

  const users = ref([])
  const groups = ref([])
  const allUsers = ref([])
  const usersLoading = ref(false)
  const groupsLoading = ref(false)
  const usersError = ref('')
  const groupsError = ref('')

  const fetchHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: token.value ? `Bearer ${token.value}` : '',
  })

  const loadUsers = async () => {
    usersLoading.value = true
    usersError.value = ''
    try {
      const res = await fetch('/api/users', { headers: fetchHeaders() })
      const json = await res.json()
      if (json.success) {
        users.value = json.data
      } else {
        usersError.value = json.error || t('users.loadFailed')
      }
    } catch (e) {
      usersError.value = t('users.loadFailed')
    } finally {
      usersLoading.value = false
    }
  }

  const loadGroups = async () => {
    groupsLoading.value = true
    groupsError.value = ''
    try {
      const res = await fetch('/api/groups?includeDeleted=false', { headers: fetchHeaders() })
      const json = await res.json()
      if (json.success) {
        groups.value = json.data
      } else {
        groupsError.value = json.error || t('groups.loadFailed')
      }
    } catch (e) {
      groupsError.value = t('groups.loadFailed')
    } finally {
      groupsLoading.value = false
    }
  }

  const loadAllUsers = async () => {
    if (allUsers.value.length) return
    try {
      const res = await fetch('/api/users', { headers: fetchHeaders() })
      const json = await res.json()
      if (json.success) allUsers.value = json.data
    } catch (e) {
      // silently fail
    }
  }

  const refreshAll = async () => {
    await Promise.all([loadUsers(), loadGroups(), loadAllUsers()])
  }

  const refreshUsers = async () => {
    await loadUsers()
    await loadAllUsers()
  }

  const refreshGroups = async () => {
    await loadGroups()
    await loadAllUsers()
  }

  const tabOptions = computed(() => {
    const base = [{ value: 'scan', label: t('scan.title'), icon: '⚙️' }]
    if (!usersLoading.value)
      base.push({ value: 'users', label: t('users.userManagement'), icon: '👤' })
    if (!groupsLoading.value)
      base.push({ value: 'groups', label: t('groups.groupManagement'), icon: '👥' })
    return base
  })

  watch(
    () => props.modelValue,
    async (open) => {
      if (open) {
        activeTab.value = 'scan'
        if (showLogs.value) {
          await nextTick()
          if (logsContainer.value) {
            logsContainer.value.scrollTop = logsContainer.value.scrollHeight
          }
        }
      }
    },
  )

  const logsContainer = ref(null)
  const autoScrollEnabled = ref(true)

  function isNearBottom(el) {
    if (!el) return true
    const threshold = 50
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }

  function onLogsScroll() {
    if (!logsContainer.value) return
    autoScrollEnabled.value = isNearBottom(logsContainer.value)
  }

  onMounted(() => {
    refreshAll()
    nextTick(() => {
      if (logsContainer.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight
        logsContainer.value.addEventListener('scroll', onLogsScroll)
      }
    })
  })

  watch(
    () => scanState.scanLogs.value,
    async () => {
      await nextTick()
      if (logsContainer.value && autoScrollEnabled.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight
      }
    },
    { deep: true },
  )
</script>
