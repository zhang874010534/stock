import { init, use } from 'echarts/core'
import { BarChart, CandlestickChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, AriaComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { formatIndexValue } from '../utils/indexHistory.js'
import { formatAmount, formatVolume, toCandlestickData } from '../utils/kline.js'

const UP_COLOR = '#4f91ff'
const DOWN_COLOR = '#38d6ac'

use([BarChart, CandlestickChart, GridComponent, TooltipComponent, DataZoomComponent, AriaComponent, SVGRenderer])

export function initIndexTrend(container, options = {}) {
  return init(container, null, { renderer: 'svg', ...options })
}

function tooltipFormatter(history, params) {
  const item = history[Array.isArray(params) ? params[0]?.dataIndex : params?.dataIndex]
  if (!item) return ''
  const date = item.startDate && item.startDate !== item.endDate ? `${item.startDate} — ${item.endDate}` : item.date
  const rows = [
    date,
    `开盘  ${formatIndexValue(item.open)}`,
    `收盘  ${formatIndexValue(item.close)}`,
    `最高  ${formatIndexValue(item.high)}`,
    `最低  ${formatIndexValue(item.low)}`,
  ]
  if (Number.isFinite(item.volume)) rows.push(`成交量  ${formatVolume(item.volume)}`)
  if (Number.isFinite(item.amount)) rows.push(`成交额  ${formatAmount(item.amount)}`)
  return rows.join('\n')
}

function formatVolumeAxis(value) {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(0)}亿`
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(0)}万`
  return String(value)
}

export function createIndexTrendOption(history, window) {
  const dates = history.map((point) => point.date)
  return {
    animation: false,
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    aria: {
      enabled: true,
      label: { description: 'H30269 指数 K 线与成交量。可通过上方按钮切换周期和时间范围。' },
    },
    grid: [
      { top: 10, right: 15, bottom: '36%', left: 55 },
      { top: '72%', right: 15, bottom: 47, left: 55 },
    ],
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: '#101d32',
      borderColor: '#334a6e',
      borderWidth: 1,
      padding: [9, 11],
      textStyle: { color: '#dbe8ff', fontSize: 11 },
      axisPointer: { type: 'cross', lineStyle: { color: '#7196cb', type: 'dashed' } },
      formatter: (params) => tooltipFormatter(history, params),
    },
    xAxis: [
      {
        type: 'category',
        gridIndex: 0,
        boundaryGap: true,
        data: dates,
        axisLine: { lineStyle: { color: '#27364d' } },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      {
        type: 'category',
        gridIndex: 1,
        boundaryGap: true,
        data: dates,
        axisLine: { lineStyle: { color: '#27364d' } },
        axisTick: { show: false },
        axisLabel: { color: '#8c9bb3', fontSize: 9, hideOverlap: true, margin: 7, formatter: (value) => value.slice(2) },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        scale: true,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#8c9bb3', fontSize: 10, formatter: (value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }) },
        splitLine: { lineStyle: { color: '#26354b88', type: 'dashed' } },
      },
      {
        type: 'value',
        gridIndex: 1,
        scale: true,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#71829d', fontSize: 9, formatter: formatVolumeAxis },
        splitLine: { lineStyle: { color: '#26354b55', type: 'dashed' } },
      },
    ],
    dataZoom: [
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        startValue: window.startIndex,
        endValue: window.endIndex,
        bottom: 3,
        left: 55,
        right: 15,
        height: 18,
        brushSelect: false,
        showDetail: false,
        throttle: 40,
        borderColor: '#31405d',
        backgroundColor: '#101b2d',
        fillerColor: '#408cff1a',
        handleSize: '110%',
        handleStyle: { color: '#203955', borderColor: '#7c9cc6' },
        moveHandleSize: 0,
        dataBackground: { lineStyle: { color: '#3f608e', opacity: .65 }, areaStyle: { color: '#274670', opacity: .35 } },
        selectedDataBackground: { lineStyle: { color: '#7099d5' }, areaStyle: { color: '#32629c', opacity: .3 } },
      },
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        startValue: window.startIndex,
        endValue: window.endIndex,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
      },
    ],
    series: [
      {
        id: 'index-kline',
        name: '指数 K 线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: toCandlestickData(history),
        itemStyle: {
          color: UP_COLOR,
          color0: DOWN_COLOR,
          borderColor: UP_COLOR,
          borderColor0: DOWN_COLOR,
        },
      },
      {
        id: 'index-volume',
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        barMaxWidth: 8,
        data: history.map((point) => ({
          value: Number.isFinite(point.volume) ? point.volume : null,
          itemStyle: { color: point.close >= point.open ? UP_COLOR : DOWN_COLOR, opacity: .62 },
        })),
      },
    ],
  }
}
