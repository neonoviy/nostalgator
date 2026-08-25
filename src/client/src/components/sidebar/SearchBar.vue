<template>
  <div class="search-bar w-100">
    <div class="search-bar__wrapper">
      <input
        v-model="searchQuery"
        type="text"
        class="form-input search-bar__input"
        :placeholder="$t('filter.searchPlaceholder')"
        @input="onInput"
        @keyup.enter="onEnter"
      />
      <button
        v-if="searchQuery"
        class="search-bar__clear"
        @click="clearSearch"
        :title="$t('filter.clearSearch')"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup>
  import { ref, watch } from 'vue'
  import { useRouter, useRoute } from 'vue-router'
  import { useI18n } from 'vue-i18n'
  import { useUrlFilters } from '../../composables/useUrlFilters.js'

  const { t } = useI18n()

  const router = useRouter()
  const route = useRoute()
  const urlFilters = useUrlFilters()

  const searchQuery = ref('')
  const debounceTimer = ref(null)

  // Initialize search from URL on load
  watch(
    () => route.query.search,
    (newSearch) => {
      if (newSearch) {
        try {
          searchQuery.value = decodeURIComponent(newSearch)
        } catch {
          searchQuery.value = newSearch
        }
      } else {
        searchQuery.value = ''
      }
    },
    { immediate: true },
  )

  // Handle input with debounce
  const onInput = () => {
    if (debounceTimer.value) {
      clearTimeout(debounceTimer.value)
    }
    debounceTimer.value = setTimeout(() => {
      urlFilters.setSearch(searchQuery.value)
    }, 500)
  }

  // Handle Enter (instant search)
  const onEnter = () => {
    if (debounceTimer.value) {
      clearTimeout(debounceTimer.value)
    }
    urlFilters.setSearch(searchQuery.value)
  }

  // Clear search
  const clearSearch = () => {
    searchQuery.value = ''
    urlFilters.setSearch('')
  }
</script>
