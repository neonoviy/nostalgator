import { createI18n } from 'vue-i18n'
import en from '../locales/en.json'
import ru from '../locales/ru.json'

/**
 * Determine the default locale:
 * 1. localStorage (if the user chose one manually)
 * 2. Browser language (navigator.language)
 * 3. Fallback to 'en'
 */
function getDefaultLocale() {
  const stored = localStorage.getItem('locale')
  if (stored && ['en', 'ru'].includes(stored)) {
    return stored
  }

  const browserLang = navigator.language?.substring(0, 2)
  if (browserLang === 'ru') return 'ru'
  return 'en'
}

const i18n = createI18n({
  legacy: false, // Composition API mode
  locale: getDefaultLocale(),
  fallbackLocale: 'en',
  messages: { en, ru },
  pluralizationRules: {
    ru: (count) => {
      const n = Math.abs(count)
      const lastTwo = n % 100
      const lastOne = n % 10
      if (lastOne === 1 && lastTwo !== 11) return 'one'
      if ([2, 3, 4].includes(lastOne) && !(lastTwo >= 12 && lastTwo <= 14)) return 'few'
      if ([0, 5, 6, 7, 8, 9].includes(lastOne) || (lastTwo >= 11 && lastTwo <= 14)) return 'many'
      return 'many'
    },
    en: (count) => (count === 1 ? 'one' : 'other'),
  },
})

export default i18n
