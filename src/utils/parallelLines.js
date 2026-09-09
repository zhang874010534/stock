// Clip an infinite line to the price panel; also handles vertical baselines.
export function clipParallelLine(a, b, through, rect) {
  if (!a || !b || !through) return null
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.hypot(dx, dy) < 1e-6) return null
  let lo = -Infinity, hi = Infinity
  for (const [origin, direction, min, max] of [
    [through.x, dx, rect.left, rect.right], [through.y, dy, rect.top, rect.bottom],
  ]) {
    if (Math.abs(direction) < 1e-10) {
      if (origin < min || origin > max) return null
    } else {
      const t1 = (min - origin) / direction, t2 = (max - origin) / direction
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2))
    }
  }
  return lo > hi ? null : { x1: through.x + lo * dx, y1: through.y + lo * dy, x2: through.x + hi * dx, y2: through.y + hi * dy }
}

export function validParallelDrawing(value) {
  return typeof value?.id === 'string' && Array.isArray(value.points) && value.points.length === 3
    && value.points.every(point => typeof point?.date === 'string' && Number.isFinite(point.price))
    && (value.points[0].date !== value.points[1].date || value.points[0].price !== value.points[1].price)
}
