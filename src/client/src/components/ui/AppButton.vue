<template>
  <button :type="type" :class="classes" :disabled="disabled || loading" @click="handleClick">
    <span v-if="loading && !saving" class="app-button__spinner">⏳</span>
    <span v-else-if="success" class="app-button__success">✅</span>
    <span v-else-if="$slots.icon" class="app-button__icon">
      <slot name="icon" />
    </span>
    <span v-if="$slots.default" class="app-button__label">
      <slot />
    </span>
  </button>
</template>

<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    modelValue: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      default: 'button',
    },
    variant: {
      type: String,
      default: 'secondary',
      validator: (v) => ['primary', 'secondary', 'danger'].includes(v),
    },
    size: {
      type: String,
      default: 'md',
      validator: (v) => ['sm', 'md', 'lg'].includes(v),
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    loading: {
      type: Boolean,
      default: false,
    },
    saving: {
      type: Boolean,
      default: false,
    },
    success: {
      type: Boolean,
      default: false,
    },
    iconOnly: {
      type: Boolean,
      default: false,
    },
    label: {
      type: String,
      default: '',
    },
    class: {
      type: String,
      default: '',
    },
  })

  const emit = defineEmits(['update:modelValue', 'click'])

  const classes = computed(() => [
    'app-button',
    `app-button--${props.variant}`,
    `app-button--${props.size}`,
    {
      'app-button--icon-only': props.iconOnly,
      'app-button--loading': props.loading && !props.saving,
      'app-button--saving': props.saving,
      'app-button--success': props.success,
    },
    props.class,
  ])

  function handleClick(event) {
    if (!props.disabled && !props.loading && !props.saving) {
      emit('update:modelValue', !props.modelValue)
      emit('click', event)
    }
  }
</script>
