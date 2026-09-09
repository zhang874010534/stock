export function getKeyboardKlineTarget(length, activeIndex, window, step) {
  if (!length) return null
  const current = Math.max(window.startIndex, Math.min(window.endIndex, activeIndex))
  const index = Math.max(0, Math.min(length - 1, current + step))
  const shift = index < window.startIndex ? index - window.startIndex
    : index > window.endIndex ? index - window.endIndex : 0
  return {
    index,
    window: { startIndex: window.startIndex + shift, endIndex: window.endIndex + shift },
  }
}
