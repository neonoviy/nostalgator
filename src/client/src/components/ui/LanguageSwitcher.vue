<template>
  <div class="language-switcher">
    <VueSelect
      v-model="locale"
      :options="langOptions"
      :no-drop="!langOptions.length"
      :reduce="(option) => option.value"
      :clearable="false"
      :searchable="false"
      append-to-body
      :calculate-position="calculatePosition"
      @update:model-value="setLanguage"
    />
  </div>
</template>

<script setup>
  import { useI18n } from 'vue-i18n'
  import { calculatePosition } from '@/composables/useVueSelectPosition'
  import VueSelect from 'vue-select'
  // import 'vue-select/dist/vue-select.css'

  const { locale, t } = useI18n()

  const langOptions = [
    { label: t('languageSwitcher.english'), value: 'en' },
    { label: t('languageSwitcher.russian'), value: 'ru' },
  ]

  const setLanguage = (lang) => {
    locale.value = lang
    localStorage.setItem('locale', lang)
  }
</script>
