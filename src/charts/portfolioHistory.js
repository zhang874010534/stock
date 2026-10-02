export { etfReturnWindow as portfolioHistoryWindow } from './etfReturn.js'

export const PORTFOLIO_HISTORY_LINES = [
  { key: 'marketValue', name: '持仓市值', color: '#69a9ff', panel: 0 },
  { key: 'invested', name: '累计买入支出', color: '#a4adbd', panel: 0 },
  { key: 'totalProfit', name: '累计盈亏', color: '#63d0b0', panel: 1 },
  { key: 'dividends', name: '到账分红（扣费后）', color: '#e1bd69', panel: 1 },
  { key: 'feeImpact', name: '费用影响（已计入盈亏）', color: '#dc8b9a', panel: 1 },
]
const amount = value => value === null ? '—' : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)} 元`

export function portfolioHistoryOption(stats, window = { startIndex: 0, endIndex: stats.points.length - 1 }, selected = {}) {
  const dates = stats.points.map(point => point.date)
  return {
    animation: false, textStyle: { color: '#959baa', fontFamily: 'sans-serif' },
    legend: [0, 1].map(panel => ({ top: panel === 0 ? 6 : 218, left: 'center', selected,
      data: PORTFOLIO_HISTORY_LINES.filter(line => line.panel === panel).map(line => line.name),
      textStyle: { color: '#aebcd1', fontSize: 10 }, itemWidth: 14, itemHeight: 8, itemGap: 12 })),
    grid: [{ left: 72, right: 18, top: 52, height: 132 }, { left: 72, right: 18, top: 274, bottom: 74 }],
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' },
      extraCssText: 'max-width: min(420px, calc(100vw - 40px)); white-space: normal; overflow-wrap: anywhere;',
      formatter(params) {
        const point = stats.points[(Array.isArray(params) ? params[0] : params)?.dataIndex]
        return point ? `${point.date}<br/>${PORTFOLIO_HISTORY_LINES.map(line => `${line.name}：${amount(point[line.key])}`).join('<br/>')}<br/>持有 ${point.shares} 份 · 持仓成本 ${amount(point.cost)}<br/>已实现交易盈亏 ${amount(point.realized)} · 浮动盈亏 ${amount(point.unrealized)}${point.valuationReason ? `<br/>${point.valuationReason}` : ''}<br/>费用已计入成本／盈亏，不再次扣除` : ''
      } },
    xAxis: [0, 1].map(gridIndex => ({ gridIndex, type: 'category', data: dates, boundaryGap: false, axisTick: { show: false },
      axisLine: { lineStyle: { color: '#383d49' } }, axisLabel: { hideOverlap: true } })),
    yAxis: [0, 1].map(gridIndex => ({ gridIndex, type: 'value', scale: true, name: '元', nameTextStyle: { color: '#959baa' },
      axisLabel: { formatter: value => Math.abs(value) >= 10000 ? `${Number((value / 10000).toFixed(1))}万` : Number(value.toFixed(2)) },
      splitLine: { lineStyle: { color: '#252832' } } })),
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], startValue: window.startIndex, endValue: window.endIndex, zoomOnMouseWheel: false, moveOnMouseWheel: false, filterMode: 'none' },
      { type: 'slider', xAxisIndex: [0, 1], bottom: 14, height: 22, startValue: window.startIndex, endValue: window.endIndex, filterMode: 'none', borderColor: '#383d49', textStyle: { color: '#959baa' } },
    ],
    series: PORTFOLIO_HISTORY_LINES.map(line => ({ id: `portfolio-${line.key}`, name: line.name, type: 'line',
      xAxisIndex: line.panel, yAxisIndex: line.panel, data: stats.points.map(point => point[line.key]), connectNulls: false,
      showSymbol: dates.length < 15, symbolSize: 4, step: ['invested', 'dividends', 'feeImpact'].includes(line.key) ? 'end' : false,
      itemStyle: { color: line.color }, lineStyle: { width: line.key === 'totalProfit' ? 2 : 1.5, type: ['invested', 'feeImpact'].includes(line.key) ? 'dashed' : 'solid' } })),
  }
}
