export function validHorizontalDrawing(value) {
  return typeof value?.id === 'string' && value.type === 'horizontal' && Number.isFinite(value.price)
}

export function clipHorizontalLine(y, rect) {
  if (!Number.isFinite(y) || y < rect.top || y > rect.bottom || rect.right <= rect.left) return null
  return { x1: rect.left, y1: y, x2: rect.right, y2: y }
}
