// Port of the supplied formula. ZIG interpolates confirmed extrema and a provisional
// final leg; both historical interpolation and provisional signals can repaint.
// Names are scoped by formula block to preserve the supplied sequential meanings.
const finite = Number.isFinite
export const refValues = (a, n = 1) => a.map((_, i) => i >= n ? a[i - n] : null)
export function smooth(a, n, m = 1) {
  if (!(n > 0 && m > 0 && m <= n)) throw new RangeError('Invalid smoothing parameters')
  let previous = null
  return a.map(x => {
    if (!finite(x)) return null
    previous = previous === null ? x : (m * x + (n - m) * previous) / n
    return previous
  })
}
const ema = (a, n) => smooth(a, (n + 1) / 2)
export function windowValues(a, n, kind = 'mean') {
  return a.map((_, i) => {
    const values = a.slice(Math.max(0, i - n + 1), i + 1)
    if (values.some(x => !finite(x))) return null
    if (kind === 'min') return Math.min(...values)
    if (kind === 'max') return Math.max(...values)
    if (kind === 'sum') return values.reduce((s, x) => s + x, 0)
    return values.length < n ? null : values.reduce((s, x) => s + x, 0) / n
  })
}
export const crossValues = (a, b) => a.map((x, i) => i > 0 && [x, b[i], a[i - 1], b[i - 1]].every(finite) && x > b[i] && a[i - 1] <= b[i - 1])
export function filterSignals(a, n) {
  let blockedThrough = -1
  return a.map((x, i) => {
    if (!x || i <= blockedThrough) return false
    blockedThrough = i + n
    return true
  })
}
const barsLast = a => {
  let last = null
  return a.map((x, i) => { if (x) last = i; return last === null ? null : i - last })
}

export function zigzag(values, percent) {
  if (!(percent > 0) || values.some(x => !finite(x) || x <= 0)) throw new RangeError('Invalid ZIG input')
  if (!values.length) return { values: [], troughs: [] }
  const threshold = percent / 100
  const pivots = [{ index: 0, price: values[0] }]
  const troughs = []
  let direction = 0, high = 0, low = 0, extreme = 0
  for (let i = 1; i < values.length; i++) {
    if (direction === 0) {
      if (values[i] >= values[high]) high = i
      if (values[i] <= values[low]) low = i
      if (values[i] >= values[low] * (1 + threshold) && i > low) {
        if (low > 0) pivots.push({ index: low, price: values[low] })
        troughs.push(low); direction = 1; extreme = i
      } else if (values[i] <= values[high] * (1 - threshold) && i > high) {
        if (high > 0) pivots.push({ index: high, price: values[high] })
        direction = -1; extreme = i
      }
    } else if (direction === 1) {
      if (values[i] >= values[extreme]) extreme = i
      else if (values[i] <= values[extreme] * (1 - threshold)) {
        pivots.push({ index: extreme, price: values[extreme] }); direction = -1; extreme = i
      }
    } else {
      if (values[i] <= values[extreme]) extreme = i
      else if (values[i] >= values[extreme] * (1 + threshold)) {
        pivots.push({ index: extreme, price: values[extreme] }); troughs.push(extreme); direction = 1; extreme = i
      }
    }
  }
  if (direction !== 0 && extreme > pivots.at(-1).index) pivots.push({ index: extreme, price: values[extreme] })
  const last = values.length - 1
  if (pivots.at(-1).index < last) pivots.push({ index: last, price: values[last] })
  const result = [...values]
  for (let p = 1; p < pivots.length; p++) {
    const a = pivots[p - 1], b = pivots[p]
    for (let i = a.index; i <= b.index; i++) result[i] = a.price + (b.price - a.price) * (i - a.index) / (b.index - a.index)
  }
  return { values: result, troughs }
}

export function calculateWaveSignals(history, { zigPercent = 10, sellPeriod = 3 } = {}) {
  if (!(zigPercent > 0) || !Number.isInteger(sellPeriod) || sellPeriod < 1) throw new RangeError('Invalid wave parameters')
  const c = history.map(p => p.close), o = history.map(p => p.open)
  const h = history.map(p => p.high), l = history.map(p => p.low)
  const v = history.map(p => finite(p.volume) ? p.volume : null)
  const amount = history.map(p => finite(p.amount) ? p.amount : null)
  const map = fn => c.map((_, i) => fn(i))
  const rsv = (prices, n) => {
    const lo = windowValues(l, n, 'min'), hi = windowValues(h, n, 'max')
    return map(i => hi[i] === lo[i] ? 0 : (prices[i] - lo[i]) / (hi[i] - lo[i]) * 100)
  }
  const buy = zigzag(c, zigPercent).values, sell = windowValues(buy, sellPeriod)
  const bullish = map(i => finite(sell[i]) && buy[i] >= sell[i])
  const base = windowValues(refValues(windowValues(c, 30, 'min')), 2)
  const maxAmount = windowValues(amount, 20, 'max'), maxClose = windowValues(c, 20, 'max')
  const saturation = map(i => finite(amount[i]) && maxAmount[i] > 0 ? Math.min(100, amount[i] / c[i] / (maxAmount[i] / maxClose[i]) * 100) : null)
  const events = history.map(() => [])
  const add = (condition, name, color, price, side = 'buy') => condition.forEach((yes, i) => {
    if (yes && finite(price[i])) events[i].push({ name, color, price: price[i], side })
  })
  const baseAt = factor => map(i => finite(base[i]) ? base[i] * factor : null)
  const lift = (a, factor) => a.map(x => x * factor)
  const zUp = z => crossValues(z, refValues(z))
  add(zUp(buy), '转向买', '#ff6655', lift(l, .97))
  add(crossValues(refValues(buy), buy), '转向卖', '#58db88', lift(h, 1.04), 'sell')
  const oscillator = p => {
    const s = smooth(rsv(p, 75), 20), ss = smooth(s, 15)
    return map(i => 100 - 3 * s[i] + 2 * ss[i])
  }
  const f1 = oscillator(c), fOpen = oscillator(o)
  const var111 = map(i => i > 0 && f1[i] < fOpen[i - 1] && finite(v[i]) && finite(v[i - 1]) && v[i] > v[i - 1] && c[i] > c[i - 1])
  const count = windowValues(var111.map(Number), 30, 'sum')
  add(map(i => var111[i] && count[i] === 1 && bullish[i]), '游资进', '#88d8ff', baseAt(.97))
  const s2 = smooth(rsv(c, 36), 3), s3 = smooth(s2, 3), s4 = smooth(s3, 3)
  const bottom = filterSignals(crossValues(s3, s4).map((x, i) => x && s3[i] < 20), 10)
  add(map(i => bottom[i] && bullish[i]), '抄底', '#ff66ee', baseAt(.94))
  const x2 = ema(map(i => (c[i] + l[i] + h[i]) / 3), 6), x3 = ema(x2, 5)
  const precise = crossValues(x2, x3)
  add(map(i => precise[i] && bullish[i]), '精准买', '#ffe34b', lift(l, .99))
  const delta = map(i => i ? c[i] - c[i - 1] : null)
  const gain = smooth(delta.map(x => finite(x) ? Math.max(x, 0) : null), 4.1)
  const absolute = smooth(delta.map(x => finite(x) ? Math.abs(x) : null), 4.1)
  const strength = map(i => absolute[i] > 0 ? gain[i] / absolute[i] * 100 : null)
  const shortCross = crossValues(strength, c.map(() => 11))
  const s1 = map(i => i >= 1 ? c[i] < o[i - 1] && delta[i] < 0 : null)
  const shortS2 = map(i => i >= 2 ? c[i] < o[i - 2] && delta[i] < 0 : null)
  add(map(i => i >= 3 && shortCross[i] && s1[i] === false && s1[i - 1] === true && shortS2[i] === false && shortS2[i - 1] === true && finite(history[i].turnover) && history[i].turnover >= 3 && bullish[i]), '短买点', '#ff66ee', baseAt(.94))
  const bullBase = smooth(smooth(rsv(c, 20), 3), 3).map(x => x / 28.57)
  const bullEma = ema(bullBase, 5), bullOsc = map(i => 3 * bullBase[i] - 2 * bullEma[i])
  const bullCross = crossValues(bullOsc, bullBase)
  add(map(i => bullCross[i] && bullish[i]), '奔牛', '#ffaa00', baseAt(.98))
  const q1 = ema(c, 3), q2 = ema(c, 21), since = barsLast(crossValues(q2, q1)), v5 = windowValues(v, 5)
  const horseCross = crossValues(q1, q2)
  add(map(i => horseCross[i] && finite(since[i]) && since[i] > 15 && finite(v[i]) && finite(v5[i]) && v[i] > v5[i] * 2 && v[i] < v5[i] * 5 && bullish[i]), '黑马', '#55aaff', baseAt(.98))
  const waveBuy = crossValues(buy, sell)
  add(waveBuy, '波段买', '#ffaa00', baseAt(.98))
  const z5 = zigzag(c, 5).values
  add(map(i => i >= 3 && z5[i] < z5[i - 1] && z5[i - 1] >= z5[i - 2] && z5[i - 2] >= z5[i - 3]), '波段卖', '#ffffff', lift(h, 1.05), 'sell')
  const r21 = rsv(c, 21), r55 = rsv(c, 55)
  const a21 = smooth(r21, 6), b21 = smooth(smooth(r21, 5), 5)
  const horseOsc = windowValues(map(i => 3 * a21[i] - 2 * b21[i]), 2)
  const a55 = smooth(r55, 5), b55 = smooth(r55, 5)
  const horseLimit = ema(map(i => 3 * a55[i] - 2 * b55[i]), 5)
  const bigCross = crossValues(horseOsc, c.map(() => 0))
  add(map(i => bigCross[i] && horseLimit[i] < 40 && bullish[i]), '大黑马', '#7095ff', baseAt(.94))

  const trough16 = new Set(zigzag(c, 16).troughs)
  const turns = [6, 22, 51, 72].map(n => {
    const z = zigzag(c, n).values
    return map(i => i >= 3 && z[i] > z[i - 1] && z[i - 1] <= z[i - 2] && z[i - 2] <= z[i - 3])
  })
  const z72 = zigzag(c, 72).values
  const flat72 = map(i => i >= 3 && z72[i] === z72[i - 2] && z72[i - 2] >= z72[i - 3])
  const e2 = ema(c, 2), e150 = ema(c, 150), var1A = ema(map(i => e2[i] - e150[i]), 100)
  const ma5 = windowValues(c, 5), ma10 = windowValues(c, 10), ma30 = windowValues(c, 30)
  const cv28 = windowValues(map(i => finite(v[i]) ? c[i] * v[i] : null), 28, 'sum'), v28 = windowValues(v, 28, 'sum')
  const varC = map(i => v28[i] > 0 ? Math.trunc(cv28[i] / v28[i] * 100) / 100 : null)
  const e5 = ema(c, 5), e10 = ema(c, 10), vare = ema(map(i => e5[i] - e10[i]), 9)
  // Preserve the supplied VAR1A comparison (EMA of a price difference), even though
  // comparing it to MA prices rarely passes. COST intermediates are unused.
  const buy3 = map(i => i > 0 && [ma5[i], ma10[i], ma30[i], varC[i]].every(finite) && o[i] <= ma5[i] && o[i] <= ma10[i] && o[i] <= ma30[i] && var1A[i] >= ma5[i] && var1A[i] >= varC[i] && vare[i] > vare[i - 1] && flat72[i])
  const vertical = map(i => (trough16.has(i) && h[i] > l[i] + .04) || turns.some(a => a[i]) || buy3[i])
  add(vertical, '共振买点', '#ff454f', lift(l, .92))
  add(zUp(zigzag(c, 8).values), '★绝佳', '#ff454f', lift(l, .928))
  return { buy, sell, bullish, ma5, base, saturation, events, vertical, waveBuy,
    missingTurnover: history.some(p => !finite(p.turnover)), historyLength: history.length }
}
