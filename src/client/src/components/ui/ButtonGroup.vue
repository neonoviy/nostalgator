<template>
  <div class="btn-group" :class="className">
    <AppButton
      v-for="option in options"
      :key="option.value"
      :class="modelValue === option.value ? 'active' : ''"
      :size="size"
      :disabled="disabled"
      @click="select(option.value)"
    >
      <template #icon>
        <span v-if="option.icon">{{ option.icon }}</span>
      </template>
      <template v-if="option.label">
        {{ option.label }}
      </template>
    </AppButton>
  </div>
</template>

<script setup>
  import { computed } from 'vue'
  import AppButton from './AppButton.vue'

  const props = defineProps({
    modelValue: {
      type: [String, Number, Boolean],
      default: '',
    },
    options: {
      type: Array,
      required: true,
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
    class: {
      type: String,
      default: '',
    },
  })

  const emit = defineEmits(['update:modelValue', 'change'])

  const className = computed(() => props.class)

  function select(value) {
    if (props.disabled) return
    emit('update:modelValue', value)
    emit('change', value)
  }
</script>


