export function calculatePosition(dropdownList, component, { width }) {
  // 1. Set fixed positioning
  dropdownList.style.position = 'fixed'

  // 2. Get exact input dimensions on screen
  const hostEl = component.$el || component
  const rect = hostEl.getBoundingClientRect()

  // 3. Force-bind dropdown width to pixel width of input
  // This fixes the issue when 'width' from params is passed incorrectly
  dropdownList.style.width = `${rect.width}px`
  dropdownList.style.minWidth = `${rect.width}px`
  dropdownList.style.maxWidth = `${rect.width}px`

  // Reset vue-select default margins that can affect width
  dropdownList.style.margin = '0'

  // 4. Calculate height for auto-flip up/down
  // Use scrollHeight if offsetHeight is 0
  const dropdownHeight = dropdownList.offsetHeight || dropdownList.scrollHeight || 250
  const windowHeight = window.innerHeight
  const spaceBelow = windowHeight - rect.bottom

  // If not enough space below — open UP
  if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
    // In vue-select v4 when opening upward need to remove default border/shadow,
    // but for now main thing — adjust coordinate to be flush
    dropdownList.style.top = `${rect.top - dropdownHeight}px`
  } else {
    // Otherwise open DOWN
    dropdownList.style.top = `${rect.bottom}px`
  }

  // 5. Precise positioning by left edge
  dropdownList.style.left = `${rect.left}px`

  // Just in case, boost z-index for fixed modals
  dropdownList.style.zIndex = '10000'
}
