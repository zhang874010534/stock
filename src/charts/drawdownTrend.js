import { formatDrawdown } from '../utils/drawdown.js'
import { formatIndexValue, getZoomWindow } from '../utils/indexHistory.js'
import { restoreKlineViewport } from '../utils/klineViewport.js'

export function drawdownWindow(previous, points, zoom) {
  if (!zoom || !previous.length || (zoom.start <= 0 && zoom.end >= 100)) return { startIndex: 0, endIndex: points.length - 1 }
  const restored = restoreKlineViewport(previous, points, getZoomWindow(previous.length, zoom.start, zoom.end))
  return { startIndex: restored.startIndex, endIndex: Math.min(points.length - 1, restored.endIndex) }
}

export function drawdownTrendOption(stats, instrument, window = { startIndex: 0, endIndex: stats.count - 1 }) {
  const max = stats.maximum, etf = instrument === '512890'
  return {
    animation: false,
    textStyle: { color: '#959baa', fontFamily: 'sans-serif' },
    grid: { left: 58, right: 16, top: 30, bottom: 82 },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' },
      formatter(params) {
        const point = stats.points[(Array.isArray(params) ? params[0] : params)?.dataIndex]
        return point ? `${point.date}<br/>回撤 ${formatDrawdown(point.value)}<br/>收盘 ${formatIndexValue(point.close, etf ? 3 : 2)} ${etf ? '元' : '点'}<br/>此前高点 ${point.peakDate}<br/>高点收盘 ${formatIndexValue(point.peakClose, etf ? 3 : 2)} ${etf ? '元' : '点'}` : ''
      },
    },
    xAxis: { type: 'category', data: stats.points.map(point => point.date), boundaryGap: false,
      axisLine: { lineStyle: { color: '#383d49' } }, axisTick: { show: false }, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', max: 0, min: Math.min(-5, Math.floor((max?.value ?? 0) * 100 * 1.15 / 5) * 5),
      axisLabel: { formatter: value => `${Number(value.toFixed(1))}%` }, splitLine: { lineStyle: { color: '#252832' } } },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, startValue: window.startIndex, endValue: window.endIndex, zoomOnMouseWheel: false, moveOnMouseWheel: false },
      { type: 'slider', xAxisIndex: 0, bottom: 14, height: 24, startValue: window.startIndex, endValue: window.endIndex,
        borderColor: '#383d49', fillerColor: '#ef697c22', textStyle: { color: '#959baa' } },
    ],
    series: [{ name: '收盘回撤', type: 'line', data: stats.points.map(point => point.value * 100),
      showSymbol: stats.count < 20, symbolSize: 4, smooth: false,
      itemStyle: { color: '#ef697c' }, lineStyle: { width: 1.5 }, areaStyle: { color: '#ef697c', opacity: .12 },
      markArea: { silent: true, itemStyle: { color: '#ef697c', opacity: .08 }, label: { color: '#d5b57f', fontSize: 10 },
        data: max ? [[{ name: '最大回撤区间', xAxis: max.peakDate }, { xAxis: max.troughDate }]] : [] },
      markPoint: { symbol: 'circle', symbolSize: 8, label: { position: 'bottom', color: '#ff9daa', fontSize: 11 },
        data: max ? [{ name: '最大回撤', coord: [max.troughDate, max.value * 100], value: formatDrawdown(max.value) }] : [] },
    }],
  }
}
