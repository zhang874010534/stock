import { comparisonPercent } from '../utils/indexComparison.js'
import { drawdownWindow } from './drawdownTrend.js'

export { drawdownWindow as comparisonWindow }
const colors = ['#67d5df', '#a69bff']
const labels = ['红利低波 H30269', '沪深300 000300']
const titles = ['累计价格收益', '区间收盘回撤', '近60个交易日年化波动率']
const fields = ['cumulativeReturn', 'drawdown', 'rollingVolatility']
export function indexComparisonOption(stats, window = { startIndex: 0, endIndex: stats.count - 1 }) {
  const dates = stats.series[0].points.map(point => point.date)
  return {
    animation: false,
    textStyle: { color: '#93a4bf', fontFamily: 'sans-serif' },
    legend: { top: 0, data: labels, textStyle: { color: '#c7d8f2' } },
    title: titles.map((text, i) => ({ text, left: 8, top: `${6 + i * 29}%`, textStyle: { fontSize: 12, color: '#c7d8f2', fontWeight: 500 } })),
    grid: [0, 1, 2].map(i => ({ left: 62, right: 14, top: `${10 + i * 29}%`, height: '20%' })),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#151e2e', borderColor: '#33435b', textStyle: { color: '#e1e8f3', fontSize: 11 },
      formatter(params) {
        const pointIndex = (Array.isArray(params) ? params[0] : params)?.dataIndex
        if (!Number.isInteger(pointIndex) || !dates[pointIndex]) return ''
        return `${dates[pointIndex]}<br/>${stats.series.map((series, i) => {
          const point = series.points[pointIndex]
          return `<span style="color:${colors[i]}">${labels[i]}</span><br/>收益 ${comparisonPercent(point.cumulativeReturn)} · 回撤 ${comparisonPercent(point.drawdown)}<br/>60日年化波动率 ${comparisonPercent(point.rollingVolatility)}`
        }).join('<br/>')}`
      },
    },
    xAxis: [0, 1, 2].map(gridIndex => ({ type: 'category', gridIndex, data: dates, boundaryGap: false,
      axisLine: { lineStyle: { color: '#33435b' } }, axisTick: { show: false }, axisLabel: { hideOverlap: true, fontSize: 10 } })),
    yAxis: [0, 1, 2].map(gridIndex => ({ type: 'value', gridIndex, ...(gridIndex === 1 ? { max: 0 } : {}),
      axisLabel: { formatter: value => `${Number(value.toFixed(1))}%`, fontSize: 10 }, splitLine: { lineStyle: { color: '#223049' } } })),
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], startValue: window.startIndex, endValue: window.endIndex, zoomOnMouseWheel: false, moveOnMouseWheel: false },
      { type: 'slider', xAxisIndex: [0, 1, 2], bottom: 10, height: 23, startValue: window.startIndex, endValue: window.endIndex,
        borderColor: '#33435b', fillerColor: '#67d5df22', textStyle: { color: '#93a4bf' } },
    ],
    series: fields.flatMap((field, gridIndex) => stats.series.map((series, i) => ({
      name: labels[i], type: 'line', xAxisIndex: gridIndex, yAxisIndex: gridIndex,
      data: series.points.map(point => point[field] == null ? null : point[field] * 100),
      showSymbol: false, connectNulls: false, smooth: false, itemStyle: { color: colors[i] }, lineStyle: { width: 1.6 },
    }))),
  }
}
