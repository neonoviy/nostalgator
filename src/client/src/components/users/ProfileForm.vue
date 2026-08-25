<template>
  <div class="profile-form form">
    <form @submit.prevent="submitProfile">
      <!-- Change username -->
      <div class="mb-md">
        <div class="form-group-row">
          <label class="form-label" for="username">{{ $t('profile.login') }}</label>
          <input
            id="username"
            v-model="username"
            class="form-input"
            type="text"
            :placeholder="$t('profile.usernamePlaceholder')"
            autocomplete="username"
            :disabled="isLoading"
          />
        </div>

        <div v-if="usernameError" class="form-error">
          {{ usernameError }}
        </div>
      </div>

      <!-- Change password -->
      <div class="form-section">
        <h4>{{ $t('profile.changePassword') }}</h4>

        <div class="form-group-row">
          <label class="form-label" for="currentPassword">{{
            $t('profile.currentPassword')
          }}</label>
          <PasswordInput
            id="currentPassword"
            v-model="currentPassword"
            autocomplete="current-password"
            :disabled="isLoading"
          />
        </div>

        <div class="form-group-row">
          <label class="form-label" for="newPassword">{{ $t('profile.newPassword') }}</label>
          <PasswordInput
            id="newPassword"
            v-model="newPassword"
            autocomplete="new-password"
            minlength="4"
            :disabled="isLoading"
          />
        </div>

        <div class="form-group-row">
          <label class="form-label" for="confirmPassword">{{ $t('profile.confirmPassword') }}</label>
          <PasswordInput
            id="confirmPassword"
            v-model="confirmPassword"
            autocomplete="new-password"
            minlength="4"
            :disabled="isLoading"
          />
        </div>

        <div v-if="passwordError" class="form-error">
          {{ passwordError }}
        </div>
      </div>

      <!-- General errors -->
      <div v-if="generalError" class="form-error form-error--general">
        {{ generalError }}
      </div>

      <!-- Buttons -->
      <div class="form-actions">
        <AppButton type="button" @click="cancel" :disabled="isLoading" class="mr-sm">
          {{ $t('common.cancel') }}
        </AppButton>
        <AppButton type="submit" variant="primary" :disabled="isLoading || !hasChanges">
          {{ isLoading ? $t('common.saving') : $t('common.save') }}
        </AppButton>
      </div>
    </form>
  </div>
</template>

<script setup>
  import { ref, computed, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppButton from '../ui/AppButton.vue'
  import PasswordInput from '../ui/PasswordInput.vue'

  const { t } = useI18n()

  const props = defineProps({
    user: {
      type: Object,
      required: true,
    },
  })

  const emit = defineEmits(['close', 'success'])

  // Form data
  const username = ref('')
  const currentPassword = ref('')
  const newPassword = ref('')
  const confirmPassword = ref('')

  // Errors
  const usernameError = ref('')
  const passwordError = ref('')
  const generalError = ref('')

  // State
  const isLoading = ref(false)

  // Reset errors
  const resetErrors = () => {
    usernameError.value = ''
    passwordError.value = ''
    generalError.value = ''
  }

  // Check for changes
  const hasChanges = computed(() => {
    const usernameChanged = username.value && username.value !== props.user.username
    const passwordChanged = newPassword.value || confirmPassword.value

    return usernameChanged || passwordChanged
  })

  // Reset form on open
  watch(
    () => props.user,
    (newUser) => {
      if (newUser) {
        username.value = newUser.username
      }
      resetErrors()
    },
    { immediate: true },
  )

  const validateUsername = () => {
    usernameError.value = ''

    if (!username.value.trim()) {
      usernameError.value = t('profile.usernameRequired')
      return false
    }

    if (username.value.length < 3) {
      usernameError.value = t('profile.usernameTooShort')
      return false
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username.value)) {
      usernameError.value = t('profile.usernameInvalidChars')
      return false
    }

    return true
  }

  const validatePassword = () => {
    passwordError.value = ''

    // If changing password
    if (newPassword.value || confirmPassword.value) {
      if (!currentPassword.value) {
        passwordError.value = t('profile.enterCurrentPassword')
        return false
      }

      if (newPassword.value.length < 4) {
        passwordError.value = t('profile.passwordTooShort')
        return false
      }

      if (newPassword.value !== confirmPassword.value) {
        passwordError.value = t('profile.passwordsNoMatch')
        return false
      }
    }

    return true
  }

  const submitProfile = async () => {
    resetErrors()

    // Validation
    const isUsernameValid =
      username.value && username.value !== props.user.username ? validateUsername() : true
    const isPasswordValid = newPassword.value || confirmPassword.value ? validatePassword() : true

    if (!isUsernameValid || !isPasswordValid) {
      return
    }

    isLoading.value = true

    try {
      const token = localStorage.getItem('auth_token')
      const body = {}

      // Add username only if changed
      if (username.value && username.value !== props.user.username) {
        body.username = username.value
      }

      // Add password only if changing
      if (newPassword.value) {
        body.currentPassword = currentPassword.value
        body.newPassword = newPassword.value
      }

      const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(body),
      })

      const responseData = await response.json()
      const data = responseData.success ? responseData.data : responseData
      const errorMsg = responseData.error?.message || data.error || ''

      if (!response.ok) {
        if (errorMsg.includes(t('profile.usernameTaken'))) {
          usernameError.value = errorMsg
        } else if (errorMsg.toLowerCase().includes('password')) {
          passwordError.value = errorMsg
        } else {
          generalError.value = errorMsg
        }
        return
      }

      emit('success', data.user)
      emit('close')
    } catch (error) {
      console.error('Profile update failed:', error)
      generalError.value = error.message || t('profile.updateError')
    } finally {
      isLoading.value = false
    }
  }

  const cancel = () => {
    emit('close')
  }
</script>
