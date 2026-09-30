import { riskPercent } from '../utils/priceRisk.js'
export { drawdownWindow as lowVolatilityWindow } from './drawdownTrend.js'

export function lowVolatilityOption(stats, window = { startIndex: 0, endIndex: stats.count - 1 }) {
  return {
    animation: false, textStyle: { color: '#93a4bf', fontFamily: 'sans-serif' },
    legend: { top: 0, textStyle: { color: '#c7d8f2' }, data: ['总波动率', '下行波动率（0%目标）'] },
    grid: { left: 58, right: 16, top: 40, bottom: 76 },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#151e2e', borderColor: '#33435b', textStyle: { color: '#e1e8f3', fontSize: 11 },
      formatter(params) {
        const point = stats.points[(Array.isArray(params) ? params[0] : params)?.dataIndex]
        return point ? `${point.date}<br/>近${stats.rollingSessions}个交易日日收益<br/>年化总波动率 ${riskPercent(point.volatility)}<br/>年化下行波动率 ${riskPercent(point.downside)}` : ''
      },
    },
    xAxis: { type: 'category', data: stats.points.map(point => point.date), boundaryGap: false,
      axisLine: { lineStyle: { color: '#33435b' } }, axisTick: { show: false }, axisLabel: { hideOverlap: true, fontSize: 10 } },
    yAxis: { type: 'value', min: 0, axisLabel: { formatter: value => `${Number(value.toFixed(1))}%` }, splitLine: { lineStyle: { color: '#223049' } } },
    dataZoom: [
      { type: 'inside', startValue: window.startIndex, endValue: window.endIndex, zoomOnMouseWheel: false, moveOnMouseWheel: false },
      { type: 'slider', bottom: 10, height: 23, startValue: window.startIndex, endValue: window.endIndex,
        borderColor: '#33435b', fillerColor: '#67d5df22', textStyle: { color: '#93a4bf' } },
    ],
    series: [
      { name: '总波动率', field: 'volatility', color: '#67d5df' },
      { name: '下行波动率（0%目标）', field: 'downside', color: '#f0a3ba' },
    ].map(({ name, field, color }) => ({ name, type: 'line',
      data: stats.points.map(point => point[field] == null ? null : point[field] * 100),
      showSymbol: false, connectNulls: false, smooth: false, itemStyle: { color }, lineStyle: { width: 1.6 },
    })),
  }
}
