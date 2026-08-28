<template>
  <label
    class="tag-badge"
    :class="{ 'tag-badge-disabled': disabled }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    v-tooltip="'Событий: ' + countTooltip"
  >
    <input
      v-if="selectable"
      type="checkbox"
      :checked="selected"
      :disabled="disabled"
      @change="$emit('update:selected', $event.target.checked)"
      class="tag-badge-checkbox"
    />
    <span class="tag-badge-name" :class="countWeightClass"
      >{{ name }} <sup v-if="count !== undefined" class="tag-badge-count">{{ count }}</sup></span
    >
  </label>
</template>

<script setup>
  import { computed } from 'vue'
  const props = defineProps({
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      default: 'tag', // 'location', 'eventType', 'participant', 'tag'
      validator: (value) => ['location', 'eventType', 'participant', 'tag'].includes(value),
    },
    count: {
      type: Number,
      default: undefined,
    },
    maxCount: {
      type: Number,
      default: 0,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    selectable: {
      type: Boolean,
      default: false,
    },
    selected: {
      type: Boolean,
      default: false,
    },
    placeData: {
      type: Object,
      default: null,
    },
  })

  const emit = defineEmits(['update:selected', 'hover'])

  const fontWeight = computed(() => {
    if (props.count == null || props.maxCount <= 0) return null
    const ratio = Math.log(props.count) / Math.log(props.maxCount)
    const w = 100 + Math.round(ratio * 6) * 100
    return w
  })

  const countWeightClass = computed(() => {
    if (fontWeight.value == null) return ''
    return `tag-badge-weight-${fontWeight.value}`
  })

  const countTooltip = computed(() => {
    return props.count != null ? String(props.count) : ''
  })

  const onMouseEnter = () => {
    emit('hover', props.placeData)
  }

  const onMouseLeave = () => {
    emit('hover', null)
  }
</script>
