import { MA_OPTIONS } from '../charts/kline/config.js'
import { MAIN_INDICATORS } from '../charts/kline/mainIndicators.js'
import { SUB_INDICATORS } from '../charts/kline/subIndicators.js'

export const PREFERENCES_KEY = 'stock:preferences:v1'
export const INSTRUMENTS = ['H30269', '512890']
const definitions = { ...MAIN_INDICATORS, ...SUB_INDICATORS }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function defaultChartPreferences() {
  return {
    period: 'day', chartType: 'candlestick',
    maOptions: MA_OPTIONS.map(line => ({ ...line, width: 1.2 })),
    bollEnabled: false, bbiEnabled: true, subIndicatorKey: 'kdj',
    indicatorSettings: Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, { ...definition.parameters }])),
  }
}

export function defaultPreferences() {
  return { schemaVersion: 1, instrument: '512890',
    charts: Object.fromEntries(INSTRUMENTS.map(code => [code, defaultChartPreferences()])),
  }
}

function validParameters(key, parameters) {
  if (!object(parameters)) return false
  if (!definitions[key].parameterFields.every(field => Number.isFinite(parameters[field.key]) &&
    parameters[field.key] >= field.min && parameters[field.key] <= field.max &&
    (field.step !== 1 || Number.isInteger(parameters[field.key])))) return false
  if (key === 'macd' && parameters.fastPeriod >= parameters.slowPeriod) return false
  if (key === 'rsi' && !(parameters.shortPeriod < parameters.mediumPeriod && parameters.mediumPeriod < parameters.longPeriod)) return false
  if (key === 'bbi' && typeof parameters.showBelowTwo !== 'boolean') return false
  return true
}

function validMA(lines) {
  return Array.isArray(lines) && lines.length === MA_OPTIONS.length &&
    lines.every(line => object(line) && Number.isInteger(line.period) && line.period >= 1 && line.period <= 250 &&
      typeof line.enabled === 'boolean' && Number.isFinite(line.width) && line.width >= .5 && line.width <= 5 &&
      typeof line.color === 'string' && /^#[\da-f]{6}$/i.test(line.color)) &&
    new Set(lines.map(line => line.period)).size === lines.length
}

// Copy only supported fields. Invalid groups revert to their defaults without
// discarding valid settings belonging to other indicators or instruments.
export function normalizePreferences(input) {
  const output = defaultPreferences()
  if (!object(input) || input.schemaVersion !== 1) return output
  if (INSTRUMENTS.includes(input.instrument)) output.instrument = input.instrument
  for (const code of INSTRUMENTS) {
    const saved = input.charts?.[code], chart = output.charts[code]
    if (!object(saved)) continue
    if (['day', 'week', 'month', 'quarter'].includes(saved.period)) chart.period = saved.period
    if (['candlestick', 'line'].includes(saved.chartType)) chart.chartType = saved.chartType
    for (const key of ['bollEnabled', 'bbiEnabled']) if (typeof saved[key] === 'boolean') chart[key] = saved[key]
    if (typeof saved.subIndicatorKey === 'string' && Object.hasOwn(SUB_INDICATORS, saved.subIndicatorKey) &&
      (saved.subIndicatorKey !== 'wave' || code === '512890')) chart.subIndicatorKey = saved.subIndicatorKey
    if (validMA(saved.maOptions)) chart.maOptions = saved.maOptions.map(({ period, enabled, color, width }) => ({ period, enabled, color, width }))
    for (const key of Object.keys(definitions)) {
      const parameters = saved.indicatorSettings?.[key]
      if (validParameters(key, parameters)) chart.indicatorSettings[key] = Object.fromEntries(
        Object.keys(definitions[key].parameters).map(field => [field, parameters[field]]),
      )
    }
  }
  return output
}
