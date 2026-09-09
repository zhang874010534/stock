import { calculateBBI, calculateBOLL } from '../../utils/indicators.js'
import { BBI_PARAMETERS, BOLL_PARAMETERS } from './config.js'
import { createLineSeries } from './series.js'

export const MAIN_INDICATORS = {
  bbi: {
    label: 'BBI',
    parameters: { ...BBI_PARAMETERS, showBelowTwo: true },
    parameterFields: [1, 2, 3, 4].map(index => ({ key: `period${index}`, label: `周期 N${index}`, min: 1, max: 250, step: 1 })),
    title: ({ period1, period2, period3, period4 }) => `BBI(${period1},${period2},${period3},${period4})`,
    calculate: calculateBBI,
    lines: [{ valueKey: 'BBI', name: 'BBI', color: '#ffd43b' }],
  },
  boll: {
    label: 'BOLL',
    parameters: BOLL_PARAMETERS,
    parameterFields: [
      { key: 'period', label: '周期 N', min: 2, max: 250, step: 1 },
      { key: 'multiplier', label: '倍数 P', min: .1, max: 10, step: .1 },
    ],
    title: ({ period, multiplier }) => `BOLL(${period},${multiplier})`,
    calculate: calculateBOLL,
    lines: [
      { valueKey: 'BOLL', name: 'BOLL', color: '#f1c75b' },
      { valueKey: 'UPPER', name: 'UPPER', color: '#b083ff' },
      { valueKey: 'LOWER', name: 'LOWER', color: '#43c8d6' },
    ],
  },
}

export function getMainIndicatorDefinition(key) {
  return MAIN_INDICATORS[key]
}

export function buildMainIndicator(history, key = 'boll', parameters, { period = 'day' } = {}) {
  const definition = MAIN_INDICATORS[key]
  if (!definition) throw new Error(`未知主图指标：${key}`)
  const settings = { ...definition.parameters, ...parameters }
  const values = definition.calculate(history, settings)
  const lines = definition.lines.map((line) => ({
    ...line,
    id: `${key}-${line.valueKey}`,
    data: values[line.valueKey],
  }))
  const signals = []
  const showBelowTwo = key === 'bbi' && period === 'day' && settings.showBelowTwo
  if (showBelowTwo) {
    let belowCount = 0
    history.forEach((point, index) => {
      const bbi = values.BBI[index]
      belowCount = Number.isFinite(point.close) && Number.isFinite(bbi) && point.close < bbi
        ? belowCount + 1 : 0
      if (belowCount === 2 && Number.isFinite(point.high)) signals.push([point.date, point.high])
    })
  }
  return {
    key,
    title: definition.title(settings),
    parameters: settings,
    lines,
    createSeries: (axisIndex) => [
      ...lines.map((line) => createLineSeries(line, axisIndex)),
      ...(showBelowTwo ? [{
        id: 'bbi-below-two',
        name: 'BBI下2',
        type: 'scatter',
        xAxisIndex: axisIndex,
        yAxisIndex: axisIndex,
        data: signals,
        symbol: 'triangle',
        symbolRotate: 180,
        symbolSize: 9,
        symbolOffset: [0, -12],
        itemStyle: { color: '#ff9f43', opacity: 1 },
        label: { show: true, formatter: 'BBI下2', position: 'top', distance: 4, color: '#ff9f43', fontSize: 10 },
        labelLayout: { hideOverlap: true },
        silent: true,
        z: 6,
      }] : []),
    ],
  }
}
