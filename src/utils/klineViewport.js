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
