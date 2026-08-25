<template>
  <div class="login-form form">
    <form @submit.prevent="submitLogin">
      <div class="form-group-row">
        <label class="form-label" for="username">{{ $t('login.username') }}</label>
        <input
          id="username"
          v-model="username"
          class="form-input"
          type="text"
          autocomplete="username"
          required
        />
      </div>

      <div class="form-group-row">
        <label class="form-label" for="username">{{ $t('login.password') }}</label>
        <div class="w-100">
          <PasswordInput
            id="password"
            v-model="password"
            autocomplete="current-password"
            required
            class="mb-sm"
          />
          <div v-if="error" class="form-error">
            {{ error }}
          </div>
          <div v-if="firstLaunch" class="form-hint">
            {{ $t('login.defaultCredentials') }}
          </div>
        </div>
      </div>

      <div class="form-actions">
        <AppButton type="submit" variant="primary" :disabled="isLoading">
          {{ isLoading ? $t('login.loggingIn') : $t('login.submit') }}
        </AppButton>
      </div>
    </form>
  </div>
</template>

<script setup>
  import { ref, inject, watch } from 'vue'
  import AppButton from '../ui/AppButton.vue'
  import PasswordInput from '../ui/PasswordInput.vue'

  const emit = defineEmits(['login-success'])

  const props = defineProps({
    // First-launch flag: when true, pre-fills default admin credentials
    firstLaunch: { type: Boolean, default: false },
  })

  const auth = inject('authContext')
  const { login } = auth

  const username = ref('')
  const password = ref('')
  const error = ref('')
  const isLoading = ref(false)

  // Pre-fill default credentials on first launch
  watch(
    () => props.firstLaunch,
    (val) => {
      if (val) {
        username.value = 'admin'
        password.value = 'admin'
      }
    },
  )

  const submitLogin = async () => {
    error.value = ''
    isLoading.value = true

    const result = await login(username.value, password.value)

    isLoading.value = false

    if (result.success) {
      emit('login-success')
      // Clear sensitive fields after successful login
      username.value = ''
      password.value = ''
    } else {
      error.value = result.error
    }
  }
</script>
