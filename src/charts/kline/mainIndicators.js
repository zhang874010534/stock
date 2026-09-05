import { calculateBOLL } from '../../utils/indicators.js'
import { BOLL_PARAMETERS } from './config.js'
import { createLineSeries } from './series.js'

export const MAIN_INDICATORS = {
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

export function buildMainIndicator(history, key = 'boll', parameters) {
  const definition = MAIN_INDICATORS[key]
  if (!definition) throw new Error(`未知主图指标：${key}`)
  const settings = { ...definition.parameters, ...parameters }
  const values = definition.calculate(history, settings)
  const lines = definition.lines.map((line) => ({
    ...line,
    id: `${key}-${line.valueKey}`,
    data: values[line.valueKey],
  }))
  return {
    key,
    title: definition.title(settings),
    parameters: settings,
    lines,
    createSeries: (axisIndex) => lines.map((line) => createLineSeries(line, axisIndex)),
  }
}
