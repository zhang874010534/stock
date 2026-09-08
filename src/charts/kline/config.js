export const KLINE_COLORS = {
  background: '#101116',
  grid: '#252730',
  text: '#b8bbc6',
  muted: '#808592',
  up: '#ff454f',
  down: '#00bec7',
  pointer: '#9297a6',
}

export const MA_OPTIONS = [
  { period: 5, enabled: false, color: '#ffd43b' },
  { period: 10, enabled: false, color: '#e4e8f1' },
  { period: 20, enabled: false, color: '#ba89ff' },
  { period: 30, enabled: true, color: '#00da75' },
  { period: 60, enabled: true, color: '#00aaff' },
]

export const KDJ_PARAMETERS = { rsvPeriod: 9, kSmoothing: 3, dSmoothing: 3 }
export const MACD_PARAMETERS = { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
export const RSI_PARAMETERS = { shortPeriod: 6, mediumPeriod: 12, longPeriod: 24 }
export const BOLL_PARAMETERS = { period: 20, multiplier: 2 }

// 图形区域与副图标题共用布局，缩放容器时无需分别计算位置。
export function getKlineLayout(height = 360, indicatorKey) {
  const available = Math.max(30, height - 108)
  // 副图保留可读空间并限制高度，让增加的画布空间优先用于价格主图。
  const volumeHeight = Math.min(96, available * .16)
  const indicatorHeight = Math.min(indicatorKey === 'wave' ? 240 : 180, available * (indicatorKey === 'wave' ? .30 : .22))
  const priceHeight = available - volumeHeight - indicatorHeight
  const volumeLabel = 8 + priceHeight + 4
  const volumeTop = volumeLabel + 22
  const indicatorLabel = volumeTop + volumeHeight + 4
  return {
    left: 62,
    right: 16,
    priceTop: 8,
    priceHeight,
    volumeLabel,
    volumeTop,
    volumeHeight,
    indicatorLabel,
    indicatorTop: indicatorLabel + 22,
    indicatorHeight,
  }
}
