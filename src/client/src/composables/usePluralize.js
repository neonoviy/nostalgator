import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export function usePluralize() {
  const { locale } = useI18n()

  const isRu = computed(() => locale.value === 'ru')

  const pluralize = (count, forms) => {
    const one = forms.one
    const few = forms.few
    const many = forms.many
    const other = forms.other

    if (isRu.value) {
      const n = Math.abs(count)
      const lastTwo = n % 100
      const lastOne = n % 10
      if (lastOne === 1 && lastTwo !== 11) return one
      if ([2, 3, 4].includes(lastOne) && !(lastTwo >= 12 && lastTwo <= 14)) return few
      return many
    }
    return count === 1 ? one : other
  }

  return { pluralize }
}
