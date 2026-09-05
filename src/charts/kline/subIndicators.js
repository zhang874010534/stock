import { calculateKDJ } from '../../utils/indicators.js'
import { KDJ_PARAMETERS } from './config.js'
import { createLineSeries } from './series.js'

// 副图注册项拥有参数、计算与 series 工厂。增加指标无需改变 Vue 图表生命周期。
export const SUB_INDICATORS = {
  kdj: {
    label: 'KDJ',
    parameters: KDJ_PARAMETERS,
    title: ({ rsvPeriod, kSmoothing, dSmoothing }) => `KDJ(${rsvPeriod},${kSmoothing},${dSmoothing})`,
    calculate: calculateKDJ,
    lines: [
      { name: 'K', color: '#ffd43b' },
      { name: 'D', color: '#00aaff' },
      { name: 'J', color: '#f087d6' },
    ],
    createSeries: (lines, axisIndex) => lines.map((line) => createLineSeries(line, axisIndex)),
  },
}

export const SUB_INDICATOR_OPTIONS = Object.entries(SUB_INDICATORS).map(([key, indicator]) => ({ key, label: indicator.label }))

export function buildSubIndicator(history, key = 'kdj', parameters) {
  const definition = SUB_INDICATORS[key]
  if (!definition) throw new Error(`未知副图指标：${key}`)
  const settings = { ...definition.parameters, ...parameters }
  const values = definition.calculate(history, settings)
  const lines = definition.lines.map((line) => ({ ...line, id: `${key}-${line.name}`, data: values[line.name] }))
  return {
    key,
    title: definition.title(settings),
    lines,
    createSeries: (axisIndex) => definition.createSeries(lines, axisIndex),
  }
}
