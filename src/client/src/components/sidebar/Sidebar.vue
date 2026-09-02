<template>
  <aside class="sidebar" :class="{ opened: isSidebarOpen }">
    <div class="sidebar-wrapper">
      <Dropdown
        v-model="langMenuOpen"
        class="langswitch"
        placement="bottom-left"
        :show-caret="false"
        :close-on-click="true"
      >
        <template #button-content>
          <span class="sidebar__lang-btn">{{ currentLang }}</span>
        </template>
        <div class="dropdown-menu-content">
          <button
            class="dropdown-menu-link"
            :class="{ active: locale === 'en' }"
            @click.prevent="setLanguage('en')"
          >
            {{ $t('languageSwitcher.english') }}
          </button>
          <button
            class="dropdown-menu-link"
            :class="{ active: locale === 'ru' }"
            @click.prevent="setLanguage('ru')"
          >
            {{ $t('languageSwitcher.russian') }}
          </button>
        </div>
      </Dropdown>
      <!-- Search and settings -->
      <div class="sidebar__header">
        <AppButton class="sidebar__toggle-btn" @click="isSidebarOpen = !isSidebarOpen" size="lg">
          {{ isSidebarOpen ? '✕' : '☰' }}
        </AppButton>
        <SearchBar />
        <div class="sidebar__settings">
          <Dropdown
            v-model="userMenuOpen"
            placement="bottom-left"
            :show-caret="false"
            :close-on-click="true"
          >
            <template #button-content>
              <span v-if="isAuthenticated" class="sidebar__avatar">{{
                user.username.charAt(0).toUpperCase()
              }}</span>
              <span v-else class="sidebar__login-btn">👤</span>
            </template>

            <div class="dropdown-menu-content">
              <div v-if="isAuthenticated" class="dropdown-menu-user">{{ user.username }}</div>
              <a
                v-if="isAuthenticated && !isAdmin"
                class="dropdown-menu-link"
                href="#"
                @click.prevent="showProfileModal = true"
              >
                {{ $t('sidebar.profile') }}
              </a>
              <a
                v-if="isAuthenticated && isAdmin"
                class="dropdown-menu-link"
                href="#"
                @click.prevent="openSettings()"
              >
                {{ $t('settings.title') }}
              </a>
              <a
                v-if="isAuthenticated"
                class="dropdown-menu-link"
                href="#"
                @click.prevent="handleLogout"
              >
                {{ $t('auth.logout') }}
              </a>
              <a v-else class="dropdown-menu-link" href="#" @click.prevent="auth.openLoginModal()">
                {{ $t('auth.login') }}
              </a>
              <div class="dropdown-menu-theme">
                <DarkmodeMenu />
              </div>
            </div>
          </Dropdown>
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
      :pre-selected-folders="settingsModal.preSelectedFolders.value"
      @close="settingsModal.closeSettingsModal()"
    />
  </aside>
</template>

<script setup>
  import { inject, ref, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import FilterPanel from './FilterPanel.vue'
  import SearchBar from './SearchBar.vue'
  import Modal from '../ui/Modal.vue'
  import Dropdown from '../ui/Dropdown.vue'
  import ProfileForm from '../users/ProfileForm.vue'
  import SettingsModal from '../settings/SettingsModal.vue'
  import AppButton from '../ui/AppButton.vue'
  import DarkmodeMenu from '../ui/DarkmodeMenu.vue'

  const { locale, t } = useI18n()

  const settingsModal = inject('settingsModalContext')
  const auth = inject('authContext')
  const { user, isAuthenticated, isAdmin, updateUser } = auth

  const isSidebarOpen = ref(false)
  const userMenuOpen = ref(false)
  const langMenuOpen = ref(false)
  const showProfileModal = ref(false)

  const currentLang = computed(() => (locale.value === 'ru' ? 'RU' : 'EN'))

  const setLanguage = (lang) => {
    locale.value = lang
    localStorage.setItem('locale', lang)
  }

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
