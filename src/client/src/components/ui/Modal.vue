<template>
  <Teleport :to="teleportTo">
    <Transition name="modal">
      <template v-if="!keepMounted">
        <div v-if="modelValue" class="modal-overlay" @click.self="handleOverlayClick">
          <div class="modal-content" :class="[sizeClass, contentClass]">
            <div class="modal-header">
              <h3>{{ title }}</h3>
              <button class="close-button" @click="close" :aria-label="$t('modal.close')">×</button>
            </div>
            <div class="modal-body">
              <slot />
            </div>
            <div v-if="type === 'confirm'" class="modal-footer">
              <AppButton @click="close">
                {{ $t('common.cancel') }}
              </AppButton>
              <AppButton :variant="confirmClass || undefined" @click="onConfirm">
                {{ confirmText }}
              </AppButton>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <div v-show="modelValue" class="modal-overlay" @click.self="handleOverlayClick">
          <div class="modal-content" :class="[sizeClass, contentClass]">
            <div class="modal-header">
              <h3>{{ title }}</h3>
              <button class="close-button" @click="close" :aria-label="$t('modal.close')">×</button>
            </div>
            <div class="modal-body">
              <slot />
            </div>
            <div v-if="type === 'confirm'" class="modal-footer">
              <AppButton @click="close">
                {{ $t('common.cancel') }}
              </AppButton>
              <AppButton :variant="confirmClass || undefined" @click="onConfirm">
                {{ confirmText }}
              </AppButton>
            </div>
          </div>
        </div>
      </template>
    </Transition>
  </Teleport>
</template>

<script setup>
  import { computed } from 'vue'
  import AppButton from './AppButton.vue'

  const props = defineProps({
    modelValue: {
      type: Boolean,
      required: true,
    },
    title: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      default: 'default',
      validator: (v) => ['default', 'confirm'].includes(v),
    },
    size: {
      type: String,
      default: 'medium',
      validator: (v) => ['small', 'medium', 'large', 'fullscreen'].includes(v),
    },
    confirmText: {
      type: String,
      default: 'Confirm',
    },
    confirmClass: {
      type: String,
      default: '',
    },
    closeOnClickOutside: {
      type: Boolean,
      default: false,
    },
    contentClass: {
      type: String,
      default: '',
    },
    keepMounted: {
      type: Boolean,
      default: false,
    },
    teleportTo: {
      type: String,
      default: 'body',
    },
  })

  const emit = defineEmits(['update:modelValue', 'confirm', 'close'])

  const sizeClass = computed(() => {
    if (props.type === 'confirm') return 'small'
    return props.size
  })

  const close = () => {
    emit('update:modelValue', false)
    emit('close')
  }

  const handleOverlayClick = () => {
    if (props.closeOnClickOutside) close()
  }

  const onConfirm = () => {
    emit('confirm')
    emit('update:modelValue', false)
  }
</script>
