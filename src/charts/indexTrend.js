import { init, use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, AriaComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { formatIndexValue } from '../utils/indexHistory.js'

use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, AriaComponent, SVGRenderer])

export function initIndexTrend(container, options = {}) {
  return init(container, null, { renderer: 'svg', ...options })
}

export function createIndexTrendOption(history, window, isDemo = false) {
  return {
    animation: false,
    color: ['#408cff'],
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    aria: {
      enabled: true,
      label: { description: `H30269 指数走势。${isDemo ? '当前为模拟数据，不代表真实行情。' : ''}可通过上方按钮切换时间范围。` },
    },
    grid: { top: 12, right: 66, bottom: 60, left: 47, containLabel: false },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: '#101d32',
      borderColor: '#334a6e',
      borderWidth: 1,
      padding: [9, 11],
      textStyle: { color: '#dbe8ff', fontSize: 11 },
      axisPointer: { type: 'line', lineStyle: { color: '#7196cb', type: 'dashed' } },
      formatter: (params) => {
        const point = params[0]
        return point ? `${point.axisValue}\n指数点位  ${formatIndexValue(point.value)}${isDemo ? '\n模拟数据 · 非真实行情' : ''}` : ''
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: history.map((point) => point.date),
      axisLine: { lineStyle: { color: '#27364d' } },
      axisTick: { show: false },
      axisLabel: { color: '#8c9bb3', fontSize: 10, hideOverlap: true, margin: 11, formatter: (value) => value.slice(2) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#8c9bb3', fontSize: 10, formatter: (value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }) },
      splitLine: { lineStyle: { color: '#26354b88', type: 'dashed' } },
    },
    dataZoom: [{
      type: 'slider',
      xAxisIndex: 0,
      startValue: window.startIndex,
      endValue: window.endIndex,
      bottom: 6,
      left: 47,
      right: 12,
      height: 19,
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
    }],
    series: [{
      id: 'index-close',
      name: '指数点位',
      type: 'line',
      data: history.map((point) => point.close),
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 5,
      smooth: false,
      lineStyle: { width: 1.6, color: '#408cff' },
      itemStyle: { color: '#408cff' },
      areaStyle: {
        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#2a6de83d' }, { offset: 1, color: '#2a6de803' }] },
      },
      endLabel: {
        show: true,
        formatter: (params) => formatIndexValue(params.value),
        color: '#f4f8ff',
        fontSize: 9,
        backgroundColor: '#297dea',
        padding: [4, 4],
        borderRadius: 3,
        distance: 5,
      },
      emphasis: { focus: 'series', lineStyle: { width: 2 } },
    }],
  }
}
