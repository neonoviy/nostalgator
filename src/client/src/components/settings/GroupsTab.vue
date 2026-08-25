<template>
  <div class="settings-modal__panel">
    <div class="settings-modal__layout">
      <div class="settings-modal__sidebar">
        <div v-if="groupsLoading" class="settings-modal__loading items-list">
          {{ $t('groups.loading') }}
        </div>
        <div v-else-if="groups.length === 0" class="settings-modal__empty items-list">
          {{ $t('groups.noGroups') }}
        </div>
        <ul v-else class="groups-list items-list">
          <li
            v-for="g in groups"
            :key="g.id"
            class="group-row"
            :class="{ active: selectedGroup?.id === g.id }"
            @click="selectGroup(g)"
          >
            <a href="#" class="group-name">
              {{ g.name }}
              <span v-if="g.canUpload" class="group-upload-icon" :title="$t('groups.canUpload')"
                >📤</span
              >
            </a>
          </li>
        </ul>
        <div class="settings-modal__sidebar-actions">
          <AppButton class="w-100" @click="startCreateGroup">
            {{ $t('groups.createGroup') }}
          </AppButton>
        </div>
      </div>

      <div class="settings-modal__content">
        <div v-if="!selectedGroup && !isCreatingGroup" class="settings-modal__placeholder">
          {{ $t('groups.selectGroup') }}
        </div>

        <form v-else-if="isCreatingGroup" class="settings-modal__form" @submit.prevent="saveGroup">
          <div class="form-wrapper">
            <div class="form-group-row">
              <label>{{ $t('groups.name') }}</label>
              <div class="w-100">
                <input
                  ref="groupNameInput"
                  v-model="groupFormData.name"
                  type="text"
                  :placeholder="$t('groups.enterName')"
                  class="form-input mb-md"
                />

                <div class="form-group mb-md">
                  <AppCheckbox v-model="groupFormData.canUpload" :label="$t('groups.canUpload')" />
                </div>

                <div v-if="localGroupsError" class="form-error">{{ localGroupsError }}</div>
              </div>
            </div>
          </div>
          <div class="form-actions">
            <AppButton
              type="submit"
              variant="primary"
              :disabled="!hasGroupChanges || savingGroup"
              :saving="savingGroup"
            >
              {{ $t('common.save') }}
            </AppButton>
          </div>
        </form>

        <form @submit.prevent="saveGroup" v-else class="settings-modal__form">
          <div class="form-wrapper">
            <div class="form-group-row">
              <label>{{ $t('groups.name') }}</label>
              <div class="w-100">
                <input
                  v-model="groupFormData.name"
                  type="text"
                  :placeholder="$t('groups.enterName')"
                  class="form-input mb-md"
                />
                <div class="form-group">
                  <AppCheckbox v-model="groupFormData.canUpload" :label="$t('groups.canUpload')" />
                </div>
              </div>
            </div>

            <div v-if="localGroupsError" class="form-error">{{ localGroupsError }}</div>

            <div class="form-group-row">
              <label>{{ $t('groups.viewUsers') }}</label>
              <div class="w-100">
                <VueSelect
                  :model-value="selectedUserIds"
                  :options="allUserOptions"
                  :reduce="(option) => option.value"
                  :multiple="true"
                  :clearable="true"
                  :disabled="groupUsersLoading"
                  :placeholder="$t('groups.selectUsers')"
                  append-to-body
                  :calculate-position="calculatePosition"
                  @update:model-value="onMembersChange"
                />
              </div>
            </div>
          </div>
          <div class="form-actions">
            <AppButton
              type="button"
              variant="danger"
              class="mr-sm"
              @click="confirmDeleteGroup(selectedGroup)"
            >
              {{ $t('groups.delete') }}
            </AppButton>
            <AppButton
              type="submit"
              variant="primary"
              :disabled="!hasGroupChanges || savingGroup"
              :saving="savingGroup"
            >
              {{ $t('common.save') }}
            </AppButton>
          </div>
        </form>
      </div>
    </div>

    <Modal
      v-model="showDeleteConfirmGroup"
      :title="$t('groups.deleteConfirmTitle')"
      type="confirm"
      :confirm-text="$t('common.delete')"
      confirm-class="danger"
      @confirm="deleteGroup"
    >
      <p>{{ $t('groups.deleteConfirmText', { name: deletingGroup?.name }) }}</p>
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

  const { t } = useI18n()
  const auth = inject('authContext')
  const { token } = auth

  const props = defineProps({
    groups: {
      type: Array,
      default: () => [],
    },
    allUsers: {
      type: Array,
      default: () => [],
    },
    groupsLoading: {
      type: Boolean,
      default: false,
    },
    groupsError: {
      type: String,
      default: '',
    },
    refreshGroups: {
      type: Function,
      default: () => Promise.resolve(),
    },
  })

  const savingGroup = ref(false)
  const selectedGroup = ref(null)
  const isCreatingGroup = ref(false)
  const deletingGroup = ref(null)
  const showDeleteConfirmGroup = ref(false)
  const groupNameInput = ref(null)
  const originalGroupData = ref(null)
  const localGroupsError = ref('')

  const groupFormData = ref({ name: '', canUpload: false })
  const groupUsers = ref([])
  const groupUsersLoading = ref(false)
  const selectedUserIds = ref([])

  const groupsAPI = '/api/groups'

  const fetchHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: token.value ? `Bearer ${token.value}` : '',
  })

  const allUserOptions = computed(() =>
    props.allUsers
      .filter((u) => u.role !== 'admin')
      .map((u) => ({ label: u.username, value: u.id })),
  )

  const selectGroup = async (g) => {
    isCreatingGroup.value = false
    selectedGroup.value = g
    groupFormData.value = { name: g.name, canUpload: g.canUpload || false }
    localGroupsError.value = ''
    selectedUserIds.value = []
    await loadGroupUsers(g.id)
    selectedUserIds.value = groupUsers.value.map((u) => u.id)
    originalGroupData.value = {
      name: g.name,
      canUpload: g.canUpload || false,
      userIds: [...selectedUserIds.value],
    }
    nextTick(() => groupNameInput.value?.focus())
  }

  const startCreateGroup = () => {
    isCreatingGroup.value = true
    selectedGroup.value = null
    groupFormData.value = { name: '', canUpload: false }
    groupUsers.value = []
    selectedUserIds.value = []
    originalGroupData.value = { name: '', canUpload: false, userIds: [] }
    localGroupsError.value = ''
    nextTick(() => groupNameInput.value?.focus())
  }

  const hasGroupChanges = computed(() => {
    if (isCreatingGroup.value) {
      return (
        groupFormData.value.name.trim() !== '' ||
        groupFormData.value.canUpload !== false ||
        selectedUserIds.value.length > 0
      )
    }
    const orig = originalGroupData.value
    if (!orig || !selectedGroup.value) return false
    return (
      groupFormData.value.name.trim() !== orig.name ||
      groupFormData.value.canUpload !== orig.canUpload ||
      JSON.stringify(selectedUserIds.value) !== JSON.stringify(orig.userIds || [])
    )
  })

  watch(isCreatingGroup, (val) => {
    if (val) nextTick(() => groupNameInput.value?.focus())
  })

  const saveGroup = async () => {
    localGroupsError.value = ''
    if (!groupFormData.value.name.trim()) {
      localGroupsError.value = t('groups.nameRequired')
      return
    }

    savingGroup.value = true
    try {
      let res
      const body = {
        name: groupFormData.value.name.trim(),
        canUpload: groupFormData.value.canUpload,
      }
      if (isCreatingGroup.value) {
        res = await fetch(groupsAPI, {
          method: 'POST',
          headers: fetchHeaders(),
          body: JSON.stringify(body),
        })
      } else {
        if (
          groupFormData.value.name.trim() === selectedGroup.value.name &&
          groupFormData.value.canUpload === (selectedGroup.value.canUpload || false)
        )
          return
        res = await fetch(`${groupsAPI}/${selectedGroup.value.id}`, {
          method: 'PUT',
          headers: fetchHeaders(),
          body: JSON.stringify(body),
        })
      }

      const json = await res.json()
      if (json.success) {
        await props.refreshGroups()
        if (isCreatingGroup.value) {
          isCreatingGroup.value = false
          await selectGroup(json.data)
        } else {
          const idx = props.groups.findIndex((g) => g.id === selectedGroup.value.id)
          if (idx !== -1) {
            selectedGroup.value = json.data
            originalGroupData.value = {
              name: json.data.name,
              canUpload: json.data.canUpload || false,
              userIds: [...selectedUserIds.value],
            }
          }
        }
      } else {
        localGroupsError.value = json.error || t('groups.saveFailed')
      }
    } catch (e) {
      localGroupsError.value = t('groups.saveFailed')
    } finally {
      savingGroup.value = false
    }
  }

  const confirmDeleteGroup = (g) => {
    deletingGroup.value = g
    showDeleteConfirmGroup.value = true
  }

  const deleteGroup = async () => {
    if (!deletingGroup.value) return
    localGroupsError.value = ''
    try {
      const res = await fetch(`${groupsAPI}/${deletingGroup.value.id}`, {
        method: 'DELETE',
        headers: fetchHeaders(),
      })
      const json = await res.json()
      if (json.success) {
        if (selectedGroup.value?.id === deletingGroup.value.id) {
          selectedGroup.value = null
          groupFormData.value = { name: '' }
          groupUsers.value = []
          selectedUserIds.value = []
        }
        await props.refreshGroups()
      } else {
        localGroupsError.value = json.error || t('groups.deleteFailed')
      }
    } catch (e) {
      localGroupsError.value = t('groups.deleteFailed')
    } finally {
      showDeleteConfirmGroup.value = false
      deletingGroup.value = null
    }
  }

  const loadGroupUsers = async (groupId) => {
    groupUsersLoading.value = true
    try {
      const res = await fetch(`${groupsAPI}/${groupId}/users`, { headers: fetchHeaders() })
      const json = await res.json()
      if (json.success) groupUsers.value = json.data
      else groupUsers.value = []
    } catch (e) {
      groupUsers.value = []
    } finally {
      groupUsersLoading.value = false
    }
  }

  const onMembersChange = async (newIds) => {
    if (!selectedGroup.value) return
    const currentIds = groupUsers.value.map((u) => u.id)
    const added = newIds.filter((id) => !currentIds.includes(id))
    const removed = currentIds.filter((id) => !newIds.includes(id))
    selectedUserIds.value = [...newIds]
    localGroupsError.value = ''
    if (!added.length && !removed.length) return
    try {
      for (const id of added) {
        const res = await fetch(`${groupsAPI}/${selectedGroup.value.id}/users`, {
          method: 'POST',
          headers: fetchHeaders(),
          body: JSON.stringify({ userId: id }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error || t('groups.addUserFailed'))
      }
      for (const id of removed) {
        const res = await fetch(`${groupsAPI}/${selectedGroup.value.id}/users/${id}`, {
          method: 'DELETE',
          headers: fetchHeaders(),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error || t('groups.removeUserFailed'))
      }
      await loadGroupUsers(selectedGroup.value.id)
    } catch (e) {
      localGroupsError.value = e.message || t('groups.saveFailed')
      await loadGroupUsers(selectedGroup.value.id)
    }
    selectedUserIds.value = groupUsers.value.map((u) => u.id)
    await props.refreshGroups()
  }
</script>
