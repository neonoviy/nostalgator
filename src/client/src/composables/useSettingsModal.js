import { ref } from 'vue'

export function useSettingsModal() {
  const showSettingsModal = ref(false)
  const settingsTab = ref('scan')
  const preSelectedFolder = ref(null)
  const preSelectedFolders = ref([])

  const openSettingsModal = (tab = 'scan', options = {}) => {
    preSelectedFolder.value = options.folder || null
    preSelectedFolders.value = Array.isArray(options.folders) ? [...options.folders] : []
    settingsTab.value = tab
    showSettingsModal.value = true
  }

  const closeSettingsModal = () => {
    showSettingsModal.value = false
  }

  return {
    showSettingsModal,
    preSelectedFolder,
    preSelectedFolders,
    openSettingsModal,
    closeSettingsModal,
  }
}
