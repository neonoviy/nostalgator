export function useFormatNumber() {
  const formatNumber = (value) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return String(value)
    const parts = num.toFixed(0).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
    return parts.join('.')
  }

  return { formatNumber }
}
