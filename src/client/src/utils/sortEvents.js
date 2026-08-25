/**
 * Sort events within a year:
 * 1. By capturedAt (date) — newest first
 * 2. If no date — by title (A-Z)
 * 3. Events with date come before events without date
 * @param {Array} events
 * @returns {Array} sorted events (in-place)
 */
export function sortEvents(events) {
  return events.sort((a, b) => {
    if (a.date && b.date) {
      return new Date(b.date) - new Date(a.date)
    }
    if (!a.date && !b.date) {
      return a.title.localeCompare(b.title)
    }
    return a.date ? -1 : 1
  })
}
