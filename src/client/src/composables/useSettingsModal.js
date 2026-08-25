import { ref } from 'vue'

export function useSettingsModal() {
  const showSettingsModal = ref(false)
  const settingsTab = ref('scan')
  const preSelectedFolder = ref(null)

  const openSettingsModal = (tab = 'scan') => {
    settingsTab.value = tab
    showSettingsModal.value = true
  }

  const closeSettingsModal = () => {
    showSettingsModal.value = false
  }

  return {
    showSettingsModal,
    preSelectedFolder,
    openSettingsModal,
    closeSettingsModal,
  }
}
