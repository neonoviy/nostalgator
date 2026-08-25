<template>
  <div class="darkmode-menu">
    <ButtonGroup v-model="storedPreferredTheme" :options="themeOptions" @change="setTheme" />
  </div>
</template>

<script setup>
  import { inject, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import ButtonGroup from '../ui/ButtonGroup.vue'

  const { t } = useI18n()

  const themeContext = inject('themeContext')
  const { storedPreferredTheme, setTheme } = themeContext

  const themeOptions = computed(() => [
    { value: 'light', icon: '☀️', title: t('darkmode.lightTitle') },
    { value: 'dark', icon: '🌙', title: t('darkmode.darkTitle') },
    { value: 'auto', label: t('darkmode.auto'), title: t('darkmode.autoTitle') },
  ])
</script>
