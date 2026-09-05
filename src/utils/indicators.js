function requirePeriod(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} 必须是正整数`)
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
