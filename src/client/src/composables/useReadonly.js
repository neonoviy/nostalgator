import { ref } from 'vue'

const isReadonly = ref(false)
let loaded = false

/**
 * Composable for checking read-only mode
 * Loads status on first call, caches result
 */
export async function loadReadonlyStatus() {
  if (loaded) return isReadonly
  try {
    const res = await fetch('/api/settings/readonly')
    const json = await res.json()
    isReadonly.value = json.data?.readonly ?? false
  } catch (err) {
    isReadonly.value = false
  }
  loaded = true
  return isReadonly
}

export function useReadonly() {
  return { isReadonly }
}
