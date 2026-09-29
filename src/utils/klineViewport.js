// Empty categories extend the draggable timeline without inventing future quotes or dates.
export function getKlineTimelineLength(length) {
  return length ? length + Math.max(150, Math.ceil(length / 2)) : 0
}

export function clampKlineViewport(length, window) {
  if (!length) return { startIndex: 0, endIndex: 0 }
  const span = window.endIndex - window.startIndex
  const startIndex = Math.min(length - 1, Math.max(0, window.startIndex))
  return { startIndex, endIndex: Math.min(getKlineTimelineLength(length) - 1, startIndex + span) }
}

// Anchor custom windows to dates, not indices: a backfill shifts every index.
// Aggregated bars can acquire a new end date while still containing the old date.
export function restoreKlineViewport(previous, history, window) {
  if (!previous.length || !history.length) return clampKlineViewport(history.length, window)
  function locate(date, end) {
    const containing = history.findIndex(bar => (bar.startDate ?? bar.date) <= date && (bar.endDate ?? bar.date) >= date)
    if (containing >= 0) return containing
    const next = history.findIndex(bar => bar.date >= date)
    if (next < 0) return history.length - 1
    return Math.max(0, end ? next - 1 : next)
  }
  const start = previous[Math.min(previous.length - 1, Math.max(0, window.startIndex))]
  const end = previous[Math.min(previous.length - 1, Math.max(0, window.endIndex))]
  const startIndex = locate(start.date, false)
  const blankBars = Math.max(0, window.endIndex - (previous.length - 1))
  const endIndex = Math.max(startIndex, locate(end.date, true) + blankBars)
  return clampKlineViewport(history.length, { startIndex, endIndex })
}
