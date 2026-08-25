<template>
  <aside class="sidebar" :class="{ opened: isSidebarOpen }">
    <AppButton class="sidebar__toggle-btn" @click="isSidebarOpen = !isSidebarOpen" size="lg">
      {{ isSidebarOpen ? '✕' : '☰' }}
    </AppButton>
    <div class="sidebar-wrapper">
      <!-- Search and settings -->
      <div class="sidebar__header">
        <SearchBar />
        <div class="sidebar__settings">
          <template v-if="isAuthenticated">
            <Dropdown
              v-model="isMenuOpen"
              placement="bottom-left"
              :show-caret="false"
              :close-on-click="true"
            >
              <template #button-content>
                <span class="sidebar__avatar">{{ user.username.charAt(0).toUpperCase() }}</span>
              </template>

              <div class="dropdown-menu-content">
                <div class="dropdown-menu-user">{{ user.username }}</div>
                <a
                  class="dropdown-menu-link"
                  href="#"
                  @click.prevent="showProfileModal = true"
                  v-if="!isAdmin"
                >
                  {{ $t('sidebar.profile') }}
                </a>
                <a
                  v-if="isAdmin"
                  class="dropdown-menu-link"
                  href="#"
                  @click.prevent="openSettings()"
                >
                  {{ $t('settings.title') }}
                </a>
                <a class="dropdown-menu-link" href="#" @click.prevent="handleLogout">
                  {{ $t('auth.logout') }}
                </a>
              </div>
            </Dropdown>
          </template>
          <template v-else>
            <button class="sidebar__login-btn" @click="auth.openLoginModal()">🗝️</button>
          </template>
        </div>
      </div>

      <!-- Filters -->
      <FilterPanel />
    </div>
    <!-- Profile modal -->
    <Modal
      v-model="showProfileModal"
      :title="$t('sidebar.profileTitle')"
      size="small"
      :close-on-click-outside="false"
    >
      <ProfileForm :user="user" @close="showProfileModal = false" @success="handleProfileUpdated" />
    </Modal>

    <!-- Unified settings modal (admin only) -->
    <SettingsModal
      v-if="isAdmin"
      v-model="settingsModal.showSettingsModal.value"
      :pre-selected-folder="settingsModal.preSelectedFolder.value"
      @close="settingsModal.closeSettingsModal()"
    />
  </aside>
</template>

<script setup>
  import { inject, ref } from 'vue'
  import FilterPanel from './FilterPanel.vue'
  import SearchBar from './SearchBar.vue'
  import Modal from '../ui/Modal.vue'
  import Dropdown from '../ui/Dropdown.vue'
  import ProfileForm from '../users/ProfileForm.vue'
  import SettingsModal from '../settings/SettingsModal.vue'
  import AppButton from '../ui/AppButton.vue'

  const settingsModal = inject('settingsModalContext')
  const auth = inject('authContext')
  const { user, isAuthenticated, isAdmin, updateUser } = auth

  const isSidebarOpen = ref(false)
  const isMenuOpen = ref(false)
  const showProfileModal = ref(false)

  const openSettings = () => {
    settingsModal?.openSettingsModal?.('scan')
  }

  const handleLogout = async () => {
    await auth.logout()
  }

  const handleProfileUpdated = (newUser) => {
    updateUser(newUser)
  }
</script>
