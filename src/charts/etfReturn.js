import { getZoomWindow } from '../utils/indexHistory.js'
import { restoreKlineViewport } from '../utils/klineViewport.js'

export function etfReturnWindow(previous, points, zoom) {
  if (!zoom || !previous.length || (zoom.start <= 0 && zoom.end >= 100)) return { startIndex: 0, endIndex: points.length - 1 }
  const restored = restoreKlineViewport(previous, points, getZoomWindow(previous.length, zoom.start, zoom.end))
  return { startIndex: restored.startIndex, endIndex: Math.min(points.length - 1, restored.endIndex) }
}
export function etfReturnOption(stats, window = { startIndex: 0, endIndex: stats.points.length - 1 }) {
  const lines = [
    { key: 'priceReturn', name: '价格收益（拆分调整）', color: '#69a9ff' },
    { key: 'cashReturn', name: '现金分红贡献', color: '#e1bd69' },
    { key: 'totalReturn', name: '含分红收益（不再投）', color: '#63d0b0' },
  ]
  return { animation: false, textStyle: { color: '#959baa', fontFamily: 'sans-serif' },
    legend: { top: 5, textStyle: { color: '#aebcd1', fontSize: 10 }, itemWidth: 16, itemHeight: 8, data: lines.map(line => line.name) },
    grid: { left: 62, right: 18, top: 52, bottom: 74 },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' },
      formatter(params) {
        const point = stats.points[(Array.isArray(params) ? params[0] : params)?.dataIndex]
        return point ? `${point.date}<br/>收盘 ${point.close.toFixed(3)} 元<br/>${lines.map(line => `${line.name} ${(point[line.key] * 100).toFixed(2)}%`).join('<br/>')}<br/>累计分红权益 ${point.cash.toFixed(4)} 元／期初份额<br/>持有份额 ${point.shares}` : ''
      } },
    xAxis: { type: 'category', data: stats.points.map(point => point.date), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: '#383d49' } }, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: value => `${Number(value.toFixed(1))}%` }, splitLine: { lineStyle: { color: '#252832' } } },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, startValue: window.startIndex, endValue: window.endIndex, zoomOnMouseWheel: false, moveOnMouseWheel: false },
      { type: 'slider', xAxisIndex: 0, bottom: 14, height: 22, startValue: window.startIndex, endValue: window.endIndex, borderColor: '#383d49', textStyle: { color: '#959baa' } },
    ],
    series: lines.map(line => ({ name: line.name, type: 'line', data: stats.points.map(point => point[line.key] * 100), showSymbol: stats.points.length < 15,
      symbolSize: 4, itemStyle: { color: line.color }, lineStyle: { width: line.key === 'totalReturn' ? 2 : 1.3, type: line.key === 'totalReturn' ? 'dashed' : 'solid' },
      step: line.key === 'cashReturn' ? 'end' : false })),
  }
}
