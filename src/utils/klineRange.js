export function getKlineRangeStats(history, firstIndex, lastIndex) {
  if (!history.length || !Number.isFinite(firstIndex) || !Number.isFinite(lastIndex)) return null
  const start = Math.max(0, Math.min(history.length - 1, Math.round(Math.min(firstIndex, lastIndex))))
  const end = Math.max(0, Math.min(history.length - 1, Math.round(Math.max(firstIndex, lastIndex))))
  const bars = history.slice(start, end + 1)
  const first = bars[0], last = bars.at(-1)
  const sum = key => bars.every(bar => Number.isFinite(bar[key])) ? bars.reduce((total, bar) => total + bar[key], 0) : null
  const high = Math.max(...bars.map(bar => bar.high)), low = Math.min(...bars.map(bar => bar.low))
  return {
    startIndex: start, endIndex: end, startDate: first.startDate ?? first.date, endDate: last.date,
    count: bars.length, startPrice: first.close, endPrice: last.close, high, low,
    average: sum('close') / bars.length, change: last.close - first.close,
    changePercent: first.close > 0 ? (last.close / first.close - 1) * 100 : null,
    amplitude: first.close > 0 ? (high - low) / first.close * 100 : null,
    volume: sum('volume'), amount: sum('amount'), turnover: sum('turnover'),
    bullish: bars.filter(bar => bar.close > bar.open).length,
    bearish: bars.filter(bar => bar.close < bar.open).length,
    flat: bars.filter(bar => bar.close === bar.open).length,
  }
}
