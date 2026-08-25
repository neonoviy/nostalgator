<template>
  <div class="password-input">
    <label v-if="label" :for="id" class="password-input__label">{{ label }}</label>
    <div class="password-input__wrapper">
      <input
        :id="id"
        v-model="innerValue"
        :type="showPassword ? 'text' : 'password'"
        class="form-input password-input__field"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :disabled="disabled"
        :minlength="minlength"
        :maxlength="maxlength"
      />
      <button
        type="button"
        class="password-input__toggle input-icon-toggle"
        :disabled="disabled"
        :aria-label="showPassword ? $t('passwordInput.hidePassword') : $t('passwordInput.showPassword')"
        :title="showPassword ? $t('passwordInput.hidePassword') : $t('passwordInput.showPassword')"
        @click="showPassword = !showPassword"
      >
        {{ showPassword ? '🙈' : '👁️' }}
      </button>
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>
    <div v-else-if="hint" class="form-hint">{{ hint }}</div>
  </div>
</template>

<script setup>
  import { ref, computed } from 'vue'

  const props = defineProps({
    modelValue: {
      type: String,
      default: '',
    },
    id: {
      type: String,
      default: undefined,
    },
    label: {
      type: String,
      default: '',
    },
    placeholder: {
      type: String,
      default: '',
    },
    autocomplete: {
      type: String,
      default: 'off',
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    error: {
      type: String,
      default: '',
    },
    hint: {
      type: String,
      default: '',
    },
    minlength: {
      type: Number,
      default: undefined,
    },
    maxlength: {
      type: Number,
      default: undefined,
    },
  })

  const emit = defineEmits(['update:modelValue'])

  const showPassword = ref(false)

  const innerValue = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
  })
</script>

<style scoped lang="scss">
  .password-input {
    width: 100%;
  }

  .password-input__wrapper {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }

  .password-input__field {
    padding-right: 44px;
  }

  .password-input__toggle {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
  }
</style>
