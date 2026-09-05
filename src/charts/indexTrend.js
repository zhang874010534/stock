import { init, use } from 'echarts/core'
import { BarChart, CandlestickChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, AriaComponent, AxisPointerComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { calculateMA } from '../utils/indicators.js'
import { formatIndexValue } from '../utils/indexHistory.js'
import { formatVolume } from '../utils/kline.js'
import { getKlineLayout, KLINE_COLORS, MA_OPTIONS } from './kline/config.js'
import { createKlineSeries } from './kline/series.js'
import { buildSubIndicator } from './kline/subIndicators.js'

use([BarChart, CandlestickChart, LineChart, GridComponent, TooltipComponent, DataZoomComponent, AriaComponent, AxisPointerComponent, SVGRenderer])

export function initIndexTrend(container, options = {}) {
  return init(container, null, { renderer: 'svg', ...options })
}

export function createKlineGrids(height) {
  const layout = getKlineLayout(height)
  return [
    { top: layout.priceTop, height: layout.priceHeight },
    { top: layout.volumeTop, height: layout.volumeHeight },
    { top: layout.indicatorTop, height: layout.indicatorHeight },
  ].map((grid) => ({ ...grid, left: layout.left, right: layout.right }))
}

export function createIndexTrendOption(history, window, {
  height = 360,
  movingAverages = MA_OPTIONS.map((item) => ({ ...item, data: calculateMA(history, item.period) })),
  subIndicator = buildSubIndicator(history),
} = {}) {
  const dates = history.map((point) => point.date)
  const layout = getKlineLayout(height)
  return {
    animation: false,
    backgroundColor: KLINE_COLORS.background,
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    aria: {
      enabled: true,
      label: { description: 'H30269 指数 K 线、均线、成交量与副图指标。可切换周期、勾选均线、滚轮缩放或拖动查看历史行情。' },
    },
    grid: createKlineGrids(height),
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      label: { backgroundColor: '#373a45', color: '#f0f1f5', fontSize: 11 },
      lineStyle: { color: KLINE_COLORS.pointer, type: 'dashed', width: 1 },
    },
    tooltip: {
      trigger: 'axis',
      showContent: false,
      axisPointer: { type: 'cross', crossStyle: { color: KLINE_COLORS.pointer, type: 'dashed' } },
    },
    xAxis: [0, 1, 2].map((gridIndex) => ({
      type: 'category',
      gridIndex,
      boundaryGap: true,
      data: dates,
      axisLine: { lineStyle: { color: KLINE_COLORS.grid } },
      axisTick: { show: false },
      axisLabel: {
        show: gridIndex === 2,
        color: KLINE_COLORS.text,
        fontSize: 10,
        hideOverlap: true,
        margin: 8,
        formatter: (value) => value.slice(2),
      },
      axisPointer: { show: true, snap: true, label: { show: gridIndex === 2 } },
      splitLine: { show: false },
    })),
    yAxis: [0, 1, 2].map((gridIndex) => ({
      type: 'value',
      gridIndex,
      scale: gridIndex !== 1,
      splitNumber: gridIndex === 0 ? 4 : 2,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: KLINE_COLORS.text,
        fontSize: 10,
        showMaxLabel: gridIndex === 0,
        formatter: gridIndex === 1 ? (value) => formatVolume(value).replace('.00', '') : (value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }),
      },
      axisPointer: { label: { formatter: ({ value }) => gridIndex === 1 ? formatVolume(value) : formatIndexValue(value) } },
      splitLine: { lineStyle: { color: KLINE_COLORS.grid, width: 1 } },
    })),
    dataZoom: [
      {
        type: 'slider',
        xAxisIndex: [0, 1, 2],
        startValue: window.startIndex,
        endValue: window.endIndex,
        filterMode: 'filter',
        bottom: 2,
        left: layout.left,
        right: layout.right,
        height: 16,
        brushSelect: false,
        showDetail: false,
        throttle: 40,
        borderColor: '#3a3d48',
        backgroundColor: '#17191f',
        fillerColor: '#9299b029',
        handleSize: '110%',
        handleStyle: { color: '#505664', borderColor: '#a5aabc' },
        moveHandleSize: 0,
        dataBackground: { lineStyle: { color: '#626979' }, areaStyle: { color: '#363b47' } },
        selectedDataBackground: { lineStyle: { color: '#a2aabd' }, areaStyle: { color: '#656e82' } },
      },
      {
        type: 'inside',
        xAxisIndex: [0, 1, 2],
        startValue: window.startIndex,
        endValue: window.endIndex,
        filterMode: 'filter',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
    ],
    series: createKlineSeries(history, movingAverages, subIndicator),
  }
}
