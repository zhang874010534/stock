function requirePeriod(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} 必须是正整数`)
}

function requirePositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} 必须是正数`)
}

function calculateEMAValues(values, period) {
  requirePeriod(period, 'EMA 周期')
  if (!values.length) return []
  const alpha = 2 / (period + 1)
  const result = [values[0]]
  for (let index = 1; index < values.length; index++) {
    result.push(values[index] * alpha + result[index - 1] * (1 - alpha))
  }
  return result
}

// 满足完整周期后才绘制 MA；保留精度，仅在 UI 格式化。
export function calculateMA(history, period) {
  requirePeriod(period, 'MA 周期')
  let sum = 0
  return history.map((point, index) => {
    sum += point.close
    if (index >= period) sum -= history[index - period].close
    return index < period - 1 ? null : sum / period
  })
}

// K、D 初值为 50，前 N-1 根使用已有窗口；最高=最低时 RSV 取 50。
// J 保留原始计算结果，可以超出 0–100。
export function calculateKDJ(history, { rsvPeriod = 9, kSmoothing = 3, dSmoothing = 3 } = {}) {
  requirePeriod(rsvPeriod, 'RSV 周期')
  requirePeriod(kSmoothing, 'K 平滑')
  requirePeriod(dSmoothing, 'D 平滑')
  const result = { K: [], D: [], J: [] }
  let k = 50
  let d = 50
  history.forEach((point, index) => {
    let high = -Infinity
    let low = Infinity
    for (let cursor = Math.max(0, index - rsvPeriod + 1); cursor <= index; cursor++) {
      high = Math.max(high, history[cursor].high)
      low = Math.min(low, history[cursor].low)
    }
    const rsv = high === low ? 50 : (point.close - low) / (high - low) * 100
    k += (rsv - k) / kSmoothing
    d += (k - d) / dSmoothing
    result.K.push(k)
    result.D.push(d)
    result.J.push(3 * k - 2 * d)
  })
  return result
}

// 国内行情软件常见口径：DIF=EMA(fast)-EMA(slow)，DEA=EMA(DIF, signal)，
// MACD 柱为 2 * (DIF - DEA)。EMA 从第一根收盘价开始递推。
export function calculateMACD(history, { fastPeriod = 12, slowPeriod = 26, signalPeriod = 9 } = {}) {
  requirePeriod(fastPeriod, 'MACD 快线周期')
  requirePeriod(slowPeriod, 'MACD 慢线周期')
  requirePeriod(signalPeriod, 'MACD 信号周期')
  if (fastPeriod >= slowPeriod) throw new RangeError('MACD 快线周期必须小于慢线周期')
  if (!history.length) return { DIF: [], DEA: [], MACD: [] }

  const closes = history.map((point) => point.close)
  const fast = calculateEMAValues(closes, fastPeriod)
  const slow = calculateEMAValues(closes, slowPeriod)
  const dif = closes.map((_, index) => fast[index] - slow[index])
  const dea = calculateEMAValues(dif, signalPeriod)
  return {
    DIF: dif,
    DEA: dea,
    MACD: dif.map((value, index) => 2 * (value - dea[index])),
  }
}

function calculateWilderRSI(history, period) {
  requirePeriod(period, 'RSI 周期')
  const result = Array(history.length).fill(null)
  if (history.length <= period) return result

  let gains = 0
  let losses = 0
  for (let index = 1; index <= period; index++) {
    const change = history[index].close - history[index - 1].close
    gains += Math.max(change, 0)
    losses += Math.max(-change, 0)
  }
  let averageGain = gains / period
  let averageLoss = losses / period

  function value() {
    if (averageGain === 0 && averageLoss === 0) return 50
    if (averageLoss === 0) return 100
    if (averageGain === 0) return 0
    const rs = averageGain / averageLoss
    return 100 - 100 / (1 + rs)
  }

  result[period] = value()
  for (let index = period + 1; index < history.length; index++) {
    const change = history[index].close - history[index - 1].close
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    averageGain = (averageGain * (period - 1) + gain) / period
    averageLoss = (averageLoss * (period - 1) + loss) / period
    result[index] = value()
  }
  return result
}

export function calculateRSI(history, { shortPeriod = 6, mediumPeriod = 12, longPeriod = 24 } = {}) {
  for (const [value, name] of [[shortPeriod, 'RSI 短周期'], [mediumPeriod, 'RSI 中周期'], [longPeriod, 'RSI 长周期']]) requirePeriod(value, name)
  if (!(shortPeriod < mediumPeriod && mediumPeriod < longPeriod)) throw new RangeError('RSI 周期必须满足短周期 < 中周期 < 长周期')
  return {
    RSI1: calculateWilderRSI(history, shortPeriod),
    RSI2: calculateWilderRSI(history, mediumPeriod),
    RSI3: calculateWilderRSI(history, longPeriod),
  }
}

// BOLL 中轨使用 N 根收盘价简单平均，标准差采用总体标准差（除以 N）。
export function calculateBOLL(history, { period = 20, multiplier = 2 } = {}) {
  requirePeriod(period, 'BOLL 周期')
  requirePositiveNumber(multiplier, 'BOLL 倍数')
  const middle = calculateMA(history, period)
  const result = { BOLL: [], UPPER: [], LOWER: [] }
  let sum = 0
  let sumSquares = 0

  history.forEach((point, index) => {
    const close = point.close
    sum += close
    sumSquares += close * close
    if (index >= period) {
      const removed = history[index - period].close
      sum -= removed
      sumSquares -= removed * removed
    }
    if (index < period - 1) {
      result.BOLL.push(null)
      result.UPPER.push(null)
      result.LOWER.push(null)
      return
    }
    const mean = middle[index]
    const variance = Math.max(0, sumSquares / period - mean * mean)
    const deviation = Math.sqrt(variance)
    result.BOLL.push(mean)
    result.UPPER.push(mean + multiplier * deviation)
    result.LOWER.push(mean - multiplier * deviation)
  })
  return result
}
