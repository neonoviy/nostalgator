<template>
  <div ref="modalRef" class="edit-tag-modal">
    <form @submit.prevent="save">
      <div class="form-group">
        <label :for="'tag-name-' + tagType">{{ $t('tag.newNamePlaceholder') }}:</label>
        <input
          :id="'tag-name-' + tagType"
          ref="nameInput"
          v-model="tagName"
          type="text"
          :placeholder="$t('tag.newNamePlaceholder')"
          :class="{ 'input-error': error }"
          @keydown.escape="cancel"
        />
        <div v-if="error" class="form-error">{{ error }}</div>
      </div>

      <div class="form-actions">
        <AppButton type="button" @click="cancel" class="mr-sm">
          {{ $t('common.cancel') }}
        </AppButton>
        <AppButton type="submit" variant="primary" :disabled="!tagName.trim() || isLoading">
          {{ isLoading ? $t('common.saving') : $t('common.save') }}
        </AppButton>
      </div>
    </form>
  </div>
</template>

<script setup>
  import { ref, onMounted, nextTick, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppButton from '../ui/AppButton.vue'

  const { t } = useI18n()

  const props = defineProps({
    tagType: {
      type: String,
      required: true, // 'places', 'eventTypes', 'participants', 'tags'
    },
    tagName: {
      type: String,
      required: true,
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
    error: {
      type: String,
      default: '',
    },
  })

  const emit = defineEmits(['save', 'cancel', 'update:error'])

  const modalRef = ref(null)
  const nameInput = ref(null)
  const tagName = ref(props.tagName)

  // Focus the input on open
  onMounted(() => {
    nextTick(() => {
      nameInput.value?.focus()
      nameInput.value?.select()
    })
  })

  // Clear error on name change
  watch(tagName, () => {
    emit('update:error', '')
  })

  // Validation
  const validate = () => {
    if (!tagName.value.trim()) {
      emit('update:error', t('tag.nameRequired'))
      return false
    }

    if (tagName.value.trim() === props.tagName) {
      emit('update:error', t('tag.enterNewName'))
      return false
    }

    return true
  }

  // Saving
  const save = () => {
    if (!validate()) return

    emit('save', tagName.value.trim())
  }

  // Cancel
  const cancel = () => {
    emit('cancel')
  }
</script>
