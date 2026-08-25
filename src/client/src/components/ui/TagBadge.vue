<template>
  <label
    class="tag-badge"
    :class="{ 'tag-badge-disabled': disabled }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <input
      v-if="selectable"
      type="checkbox"
      :checked="selected"
      :disabled="disabled"
      @change="$emit('update:selected', $event.target.checked)"
      class="tag-badge-checkbox"
    />
    <span class="tag-badge-name"
      >{{ name }} <sup v-if="count !== undefined" class="tag-badge-count">{{ count }}</sup></span
    >
  </label>
</template>

<script setup>
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

  const onMouseEnter = () => {
    emit('hover', props.placeData)
  }

  const onMouseLeave = () => {
    emit('hover', null)
  }
</script>
