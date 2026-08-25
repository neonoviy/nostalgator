<template>
  <label class="app-checkbox" :class="[props.class, { 'app-checkbox--disabled': disabled }]">
    <input
      :ref="setInputRef"
      type="checkbox"
      :checked="computedChecked"
      :disabled="disabled"
      @change="onChange"
    />
    <span v-if="$slots.default" class="app-checkbox__label">
      <slot />
    </span>
    <span v-else-if="label" class="app-checkbox__label">{{ label }}</span>
  </label>
</template>

<script setup>
  import { ref, watch, computed } from 'vue'

  const props = defineProps({
    modelValue: {
      type: Boolean,
      default: false,
    },
    checked: {
      type: Boolean,
      default: undefined,
    },
    label: {
      type: String,
      default: '',
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    indeterminate: {
      type: Boolean,
      default: false,
    },
    class: {
      type: String,
      default: '',
    },
  })

  const emit = defineEmits(['update:modelValue', 'change'])

  const inputRef = ref(null)

  const computedChecked = computed(() => {
    if (props.checked !== undefined) return props.checked
    return props.modelValue
  })

  function setInputRef(el) {
    inputRef.value = el
    if (el) {
      el.indeterminate = props.indeterminate
    }
  }

  watch(
    () => props.indeterminate,
    (val) => {
      if (inputRef.value) {
        inputRef.value.indeterminate = val
      }
    },
  )

  function onChange(event) {
    const checked = event.target.checked
    if (props.checked === undefined) {
      emit('update:modelValue', checked)
    }
    emit('change', checked)
  }
</script>


