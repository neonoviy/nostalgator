<template>
  <div class="settings-modal__panel">
    <div class="settings-modal__layout">
      <div class="settings-modal__sidebar">
        <div v-if="usersLoading" class="settings-modal__loading">{{ $t('users.loading') }}</div>
        <div v-else-if="users.length === 0" class="settings-modal__empty">
          {{ $t('users.noUsers') }}
        </div>
        <ul v-else class="users-list items-list">
          <li
            v-for="u in users"
            :key="u.id"
            class="user-row"
            :class="{
              active: selectedUser?.id === u.id,
              'user-row--admin': u.role === 'admin',
            }"
            @click="selectUser(u)"
          >
            <a href="#" class="user-info">
              <span class="user-name">{{ u.username }}</span>
              <span class="user-role" :class="`user-role--${u.role}`">
                {{ u.role === 'admin' ? '👑' : '' }}
              </span>
              <span v-if="canUserUpload(u)" class="user-upload-icon" :title="$t('users.canUpload')"
                >📤</span
              >
            </a>
          </li>
        </ul>
        <div class="settings-modal__sidebar-actions">
          <AppButton class="w-100" @click="startCreateUser">
            {{ $t('users.createUser') }}
          </AppButton>
        </div>
      </div>

      <div class="settings-modal__content">
        <div v-if="!selectedUser && !isCreatingUser" class="settings-modal__placeholder">
          {{ $t('users.selectUser') }}
        </div>
        <form v-else class="user-form settings-modal__form" @submit.prevent="saveUser">
          <div class="form-wrapper">
            <div class="form-group-row">
              <label>{{ $t('users.username') }}</label>
              <div class="w-100">
                <input
                  ref="usernameInput"
                  v-model="formData.username"
                  type="text"
                  class="form-input"
                  @blur="validateUsername"
                  autocomplete="username"
                />
                <div v-if="usernameError" class="form-error">{{ usernameError }}</div>
              </div>
            </div>

            <div class="form-group-row">
              <label>{{ $t('users.password') }}</label>
              <div class="w-100">
                <PasswordInput
                  v-model="formData.password"
                  id="new-password"
                  autocomplete="off"
                  :hint="editingUser ? $t('users.passwordLeaveBlank') : ''"
                />
              </div>
            </div>

            <div class="form-group-row">
              <label>{{ $t('users.role') }}</label>
              <div class="w-100">
                <div class="w-100 mb-md">
                  <ButtonGroup
                    v-model="formData.role"
                    :options="roleOptions"
                    :disabled="isLastAdmin"
                  />

                  <small v-if="isLastAdmin" class="form-hint">
                    {{ $t('users.lastAdminError') }}
                  </small>
                </div>

                <div v-if="formData.role !== 'admin'" class="form-group w-100">
                  <AppCheckbox v-model="formData.canUpload" :label="$t('users.canUpload')" />
                </div>
              </div>
            </div>

            <div class="form-group-row" v-if="formData.role !== 'admin'">
              <label>{{ $t('users.groups') }}</label>
              <VueSelect
                v-model="groupModel"
                v-if="groupOptions.length"
                :options="groupOptions"
                :no-drop="!groupOptions.length"
                multiple
                taggable
                :create-option="(label) => ({ label, value: label })"
                :reduce="(option) => option.value"
                :loading="false"
                append-to-body
                :calculate-position="calculatePosition"
              />
              <div v-else class="pt-sm w-100 muted">
                {{ $t('users.noGroups') }}
              </div>
            </div>

            <div v-if="localUsersError" class="form-error">{{ localUsersError }}</div>
          </div>
          <div class="form-actions">
            <AppButton
              v-if="editingUser"
              type="button"
              variant="danger"
              :disabled="isLastAdmin"
              @click="confirmDeleteUser(editingUser)"
              class="mr-sm"
            >
              {{ $t('users.delete') }}
            </AppButton>
            <AppButton
              type="submit"
              variant="primary"
              :disabled="!hasUserChanges || savingUser"
              :saving="savingUser"
            >
              {{ editingUser ? $t('common.save') : $t('common.create') }}
            </AppButton>
          </div>
        </form>
      </div>
    </div>

    <Modal
      v-model="showDeleteConfirmUser"
      :title="$t('users.deleteConfirmTitle')"
      type="confirm"
      :confirm-text="$t('common.delete')"
      confirm-class="danger"
      @confirm="deleteUser"
    >
      <p>{{ $t('users.deleteConfirmText', { username: deletingUser?.username }) }}</p>
    </Modal>
  </div>
</template>

<script setup>
  import { ref, computed, inject, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import Modal from '../ui/Modal.vue'
  import { calculatePosition } from '@/composables/useVueSelectPosition'
  import VueSelect from 'vue-select'
  import 'vue-select/dist/vue-select.css'
  import AppButton from '../ui/AppButton.vue'
  import AppCheckbox from '../ui/AppCheckbox.vue'
  import ButtonGroup from '../ui/ButtonGroup.vue'
  import PasswordInput from '../ui/PasswordInput.vue'

  const { t } = useI18n()
  const auth = inject('authContext')
  const { token } = auth

  const props = defineProps({
    users: {
      type: Array,
      default: () => [],
    },
    groups: {
      type: Array,
      default: () => [],
    },
    usersLoading: {
      type: Boolean,
      default: false,
    },
    usersError: {
      type: String,
      default: '',
    },
    refreshUsers: {
      type: Function,
      default: () => Promise.resolve(),
    },
  })

  const savingUser = ref(false)
  const usernameError = ref('')
  const originalUserData = ref(null)
  const localUsersError = ref('')

  const selectedUser = ref(null)
  const isCreatingUser = ref(false)
  const editingUser = computed(() => selectedUser.value)
  const deletingUser = ref(null)
  const showDeleteConfirmUser = ref(false)
  const usernameInput = ref(null)

  const isLastAdmin = computed(() => {
    if (!editingUser.value || editingUser.value.role !== 'admin') return false
    return props.users.filter((u) => u.role === 'admin').length <= 1
  })

  const groupCanUploadMap = computed(() => {
    const map = {}
    for (const g of props.groups) {
      map[g.id] = g.canUpload === true
    }
    return map
  })

  const canUserUpload = (u) => {
    if (!u || u.role === 'admin') return false
    if (u.canUpload === true) return true
    return (u.groupIds || []).some((id) => groupCanUploadMap.value[id])
  }

  const hasUserChanges = computed(() => {
    if (!editingUser.value) {
      return (
        formData.value.username.trim() !== '' ||
        formData.value.password !== '' ||
        formData.value.role !== 'user' ||
        formData.value.canUpload !== false ||
        selectedGroupIds.value.length > 0
      )
    }
    const orig = originalUserData.value
    if (!orig) return false
    return (
      formData.value.username !== orig.username ||
      formData.value.role !== orig.role ||
      formData.value.canUpload !== orig.canUpload ||
      JSON.stringify(selectedGroupIds.value) !== JSON.stringify(orig.groupIds || [])
    )
  })

  const formData = ref({
    username: '',
    password: '',
    role: 'user',
    canUpload: false,
  })

  const selectedGroupIds = ref([])

  const roleOptions = computed(() => [
    { label: t('users.user'), value: 'user' },
    { label: t('users.admin'), value: 'admin' },
  ])

  const groupOptions = computed(() => props.groups.map((g) => ({ label: g.name, value: g.name })))

  const groupModel = computed({
    get: () =>
      selectedGroupIds.value
        .map((id) => props.groups.find((g) => g.id === id))
        .filter(Boolean)
        .map((g) => g.name),
    set: (val) => {
      selectedGroupIds.value = val
        .map((name) => props.groups.find((g) => g.name === name))
        .filter(Boolean)
        .map((g) => g.id)
    },
  })

  const validateUsername = () => {
    usernameError.value = ''
    const val = formData.value.username.trim()

    if (!val) {
      usernameError.value = t('users.usernameRequired')
      return false
    }
    if (val.length < 3) {
      usernameError.value = t('users.usernameTooShort')
      return false
    }
    if (!/^[a-zA-Z0-9_]+$/.test(val)) {
      usernameError.value = t('users.usernameInvalidChars')
      return false
    }

    const current = selectedUser.value?.username
    if (current && val !== current) {
      const exists = props.users.some((u) => u.username === val && u.id !== selectedUser.value.id)
      if (exists) {
        usernameError.value = t('users.usernameTaken')
        return false
      }
    }

    return true
  }

  const selectUser = (u) => {
    if (selectedUser.value?.id === u.id) return
    selectedUser.value = u
    isCreatingUser.value = false
    formData.value = {
      username: u.username,
      password: '',
      role: u.role,
      canUpload: u.canUpload || false,
    }
    selectedGroupIds.value = [...(u.groupIds || [])]
    originalUserData.value = {
      username: u.username,
      role: u.role,
      canUpload: u.canUpload || false,
      groupIds: [...(u.groupIds || [])],
    }
    usernameError.value = ''
    localUsersError.value = ''
  }

  const startCreateUser = async () => {
    selectedUser.value = null
    isCreatingUser.value = true
    formData.value = { username: '', password: '', role: 'user', canUpload: false }
    selectedGroupIds.value = []
    originalUserData.value = {
      username: '',
      password: '',
      role: 'user',
      canUpload: false,
      groupIds: [],
    }
    usernameError.value = ''
    localUsersError.value = ''
    await nextTick()
    usernameInput.value?.focus()
  }

  watch(isCreatingUser, (val) => {
    if (val) nextTick(() => usernameInput.value?.focus())
  })

  const syncGroupNamesToIds = async () => {
    const names = groupModel.value
    const nameToId = new Map(props.groups.map((g) => [g.name, g.id]))
    const newIds = []

    for (const name of names) {
      if (nameToId.has(name)) {
        newIds.push(nameToId.get(name))
      } else {
        return false
      }
    }

    selectedGroupIds.value = newIds
    return true
  }

  const saveUser = async () => {
    usernameError.value = ''
    localUsersError.value = ''

    if (!validateUsername()) {
      return
    }
    if (!selectedUser.value && !formData.value.password) {
      localUsersError.value = t('users.passwordRequired')
      return
    }

    const ok = await syncGroupNamesToIds()
    if (!ok) return

    savingUser.value = true
    try {
      const body = {
        username: formData.value.username.trim(),
        role: formData.value.role,
        groupIds: selectedGroupIds.value,
        canUpload: formData.value.canUpload,
      }
      if (formData.value.password) {
        body.password = formData.value.password
      }

      let res
      if (selectedUser.value) {
        res = await fetch(`/api/users/${selectedUser.value.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token.value ? `Bearer ${token.value}` : '',
          },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/api/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token.value ? `Bearer ${token.value}` : '',
          },
          body: JSON.stringify(body),
        })
      }

      const json = await res.json()
      if (json.success) {
        await props.refreshUsers()
        if (selectedUser.value) {
          const updated = props.users.find((u) => u.id === selectedUser.value.id)
          if (updated) {
            selectedUser.value = updated
            selectedGroupIds.value = [...(updated.groupIds || [])]
            formData.value = {
              username: updated.username,
              password: '',
              role: updated.role,
              canUpload: updated.canUpload || false,
            }
            originalUserData.value = {
              username: updated.username,
              role: updated.role,
              canUpload: updated.canUpload || false,
              groupIds: [...(updated.groupIds || [])],
            }
          }
        } else {
          isCreatingUser.value = false
          const newUser = props.users.find((u) => u.username === formData.value.username.trim())
          if (newUser) {
            selectedUser.value = newUser
            selectedGroupIds.value = [...(newUser.groupIds || [])]
            formData.value = {
              username: newUser.username,
              password: '',
              role: newUser.role,
              canUpload: newUser.canUpload || false,
            }
            originalUserData.value = {
              username: newUser.username,
              role: newUser.role,
              canUpload: newUser.canUpload || false,
              groupIds: [...(newUser.groupIds || [])],
            }
          } else {
            selectedUser.value = null
            selectedGroupIds.value = []
            formData.value = { username: '', password: '', role: 'user', canUpload: false }
            originalUserData.value = null
          }
        }
      } else {
        const errorMsg = json.error || t('users.saveFailed')
        if (errorMsg.includes(t('users.usernameTaken'))) {
          usernameError.value = errorMsg
        } else {
          localUsersError.value = errorMsg
        }
      }
    } catch (e) {
      localUsersError.value = t('users.saveFailed')
    } finally {
      savingUser.value = false
    }
  }

  const confirmDeleteUser = (u) => {
    deletingUser.value = u
    showDeleteConfirmUser.value = true
  }

  const deleteUser = async () => {
    if (!deletingUser.value) return
    localUsersError.value = ''
    try {
      const res = await fetch(`/api/users/${deletingUser.value.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
      })
      const json = await res.json()
      if (json.success) {
        if (selectedUser.value?.id === deletingUser.value.id) {
          selectedUser.value = null
        }
        await props.refreshUsers()
      } else {
        localUsersError.value = json.error || t('users.deleteFailed')
      }
    } catch (e) {
      localUsersError.value = t('users.deleteFailed')
    } finally {
      showDeleteConfirmUser.value = false
      deletingUser.value = null
    }
  }
</script>
