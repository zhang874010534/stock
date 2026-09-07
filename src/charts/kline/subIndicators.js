import { calculateKDJ, calculateMACD, calculateRSI } from '../../utils/indicators.js'
import { KDJ_PARAMETERS, KLINE_COLORS, MACD_PARAMETERS, RSI_PARAMETERS } from './config.js'
import { createLineSeries } from './series.js'
import { waveDefinition } from './waveIndicator.js'

function line(id, name, color, data) {
  return { id, name, color, data, type: 'line' }
}

function createMacdSeries(lines, axisIndex) {
  const [dif, dea, histogram] = lines
  return [
    createLineSeries(dif, axisIndex),
    createLineSeries(dea, axisIndex),
    {
      id: histogram.id,
      name: histogram.name,
      type: 'bar',
      xAxisIndex: axisIndex,
      yAxisIndex: axisIndex,
      data: histogram.data,
      barMaxWidth: 8,
      itemStyle: {
        color: ({ value }) => Number(value) >= 0 ? KLINE_COLORS.up : KLINE_COLORS.down,
      },
      emphasis: { disabled: true },
    },
  ]
}

// 注册项同时描述默认参数、参数表单、计算口径、读数和图表 series。
// 后续增加副图指标时只需新增注册项，不改 Vue 图表生命周期。
export const SUB_INDICATORS = {
  kdj: {
    label: 'KDJ',
    parameters: KDJ_PARAMETERS,
    parameterFields: [
      { key: 'rsvPeriod', label: 'RSV 周期 N', min: 1, max: 250, step: 1 },
      { key: 'kSmoothing', label: 'K 平滑 M1', min: 1, max: 50, step: 1 },
      { key: 'dSmoothing', label: 'D 平滑 M2', min: 1, max: 50, step: 1 },
    ],
    title: ({ rsvPeriod, kSmoothing, dSmoothing }) => `KDJ(${rsvPeriod},${kSmoothing},${dSmoothing})`,
    calculate: calculateKDJ,
    createLines: (values) => [
      line('kdj-K', 'K', '#ffd43b', values.K),
      line('kdj-D', 'D', '#00aaff', values.D),
      line('kdj-J', 'J', '#f087d6', values.J),
    ],
    createSeries: (lines, axisIndex) => lines.map((item) => createLineSeries(item, axisIndex)),
  },
  macd: {
    label: 'MACD',
    parameters: MACD_PARAMETERS,
    parameterFields: [
      { key: 'fastPeriod', label: '快线 SHORT', min: 1, max: 250, step: 1 },
      { key: 'slowPeriod', label: '慢线 LONG', min: 2, max: 500, step: 1 },
      { key: 'signalPeriod', label: '信号 M', min: 1, max: 250, step: 1 },
    ],
    title: ({ fastPeriod, slowPeriod, signalPeriod }) => `MACD(${fastPeriod},${slowPeriod},${signalPeriod})`,
    calculate: calculateMACD,
    createLines: (values) => [
      line('macd-DIF', 'DIF', '#ffd43b', values.DIF),
      line('macd-DEA', 'DEA', '#f087d6', values.DEA),
      { ...line('macd-MACD', 'MACD', KLINE_COLORS.up, values.MACD), type: 'bar' },
    ],
    createSeries: createMacdSeries,
  },
  rsi: {
    label: 'RSI',
    parameters: RSI_PARAMETERS,
    parameterFields: [
      { key: 'shortPeriod', label: '短周期 N1', min: 1, max: 250, step: 1 },
      { key: 'mediumPeriod', label: '中周期 N2', min: 2, max: 500, step: 1 },
      { key: 'longPeriod', label: '长周期 N3', min: 3, max: 750, step: 1 },
    ],
    title: ({ shortPeriod, mediumPeriod, longPeriod }) => `RSI(${shortPeriod},${mediumPeriod},${longPeriod})`,
    calculate: calculateRSI,
    createLines: (values, settings) => [
      line('rsi-1', `RSI${settings.shortPeriod}`, '#ffd43b', values.RSI1),
      line('rsi-2', `RSI${settings.mediumPeriod}`, '#b083ff', values.RSI2),
      line('rsi-3', `RSI${settings.longPeriod}`, '#43c8d6', values.RSI3),
    ],
    createSeries: (lines, axisIndex) => lines.map((item) => createLineSeries(item, axisIndex)),
    axis: { min: 0, max: 100, splitNumber: 4 },
  },
  wave: waveDefinition,
}

export const SUB_INDICATOR_OPTIONS = Object.entries(SUB_INDICATORS).map(([key, indicator]) => ({ key, label: indicator.label }))

export function getSubIndicatorDefinition(key) {
  return SUB_INDICATORS[key]
}

export function buildSubIndicator(history, key = 'kdj', parameters) {
  const definition = SUB_INDICATORS[key]
  if (!definition) throw new Error(`未知副图指标：${key}`)
  const settings = { ...definition.parameters, ...parameters }
  const values = definition.calculate(history, settings)
  const lines = definition.createLines(values, settings)
  return {
    key,
    title: definition.title(settings),
    parameters: settings,
    lines,
    values,
    axis: definition.axis,
    createSeries: (axisIndex) => definition.createSeries(lines, axisIndex, values, history),
  }
}
