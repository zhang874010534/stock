import { tradingCalendar } from '../data/tradingCalendar.js'
import { VALUATION_SOURCE } from '../api/valuations.js'

export const RULE_VERSION = 'latest-metrics-v2-all-history'
export const DIVIDEND_SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls'
export const METRIC_DEFINITIONS = {
  pe: { unit: 'multiple', source: VALUATION_SOURCE, basis: 'provider_unspecified' },
  pb: { unit: 'multiple', source: VALUATION_SOURCE, basis: 'provider_unspecified' },
  dividendYield: { unit: 'ratio', source: DIVIDEND_SOURCE, basis: 'total_share_capital' },
  annualReturn: { unit: 'ratio', source: '/data/h30269.json', basis: 'price_index_act365' },
  maxDrawdown: { unit: 'ratio', source: '/data/h30269.json', basis: 'price_index_close_drawdown' },
  sharpe: { unit: 'dimensionless', source: '/data/h30269.json', basis: 'price_index_daily_sample_rf0_252' },
}
const PERFORMANCE = ['annualReturn', 'maxDrawdown', 'sharpe']
const DAY = 86_400_000

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

export function dateTimestamp(day) {
  requireValue(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day), '日期格式异常')
  const time = Date.parse(`${day}T00:00:00Z`)
  requireValue(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day, '日期无效')
  return time
}

function chinaNow(now) {
  const time = new Date(now).getTime()
  requireValue(Number.isFinite(time), '当前时间无效')
  return new Date(time + 8 * 3600_000).toISOString()
}

function validAsOf(day, now) {
  dateTimestamp(day)
  requireValue(day <= chinaNow(now).slice(0, 10), '数据日期不能晚于今天')
}

export function isTradingDay(day, calendar = tradingCalendar) {
  const time = dateTimestamp(day)
  requireValue(calendar && day >= calendar.start && day <= calendar.end, '交易日历待核验')
  const weekday = new Date(time).getUTCDay()
  return weekday !== 0 && weekday !== 6 && !calendar.closures.some(([start, end]) => day >= start && day <= end)
}

export function performanceWindow(start, end, calendar = tradingCalendar) {
  requireValue(dateTimestamp(start) < dateTimestamp(end), '收益样本不足')
  requireValue(isTradingDay(start, calendar), '首条行情日期不是交易日')
  requireValue(isTradingDay(end, calendar), '最新行情日期不是交易日')
  return { start, end }
}

export function calculatePerformance(market, { calendar = tradingCalendar, now = new Date() } = {}) {
  requireValue(market?.code === 'H30269' && market.source === 'eastmoney' && market.interval === '1d', '指数行情身份或频率异常')
  requireValue(Array.isArray(market.history) && market.history.length > 0, '暂无指数行情')
  const dates = new Set()
  for (const row of market.history) {
    dateTimestamp(row?.date)
    requireValue(!dates.has(row.date), `行情日期重复：${row.date}`)
    requireValue(Number.isFinite(row.close) && row.close > 0, `收盘价无效：${row.date}`)
    dates.add(row.date)
  }
  const history = [...market.history].sort((a, b) => a.date.localeCompare(b.date))
  const latest = history.at(-1)
  requireValue(market.latest && Object.keys({ ...latest, ...market.latest }).every(key => latest[key] === market.latest[key]), 'latest 与历史末条不一致')
  validAsOf(latest.date, now)
  const localNow = chinaNow(now)
  requireValue(latest.date !== localNow.slice(0, 10) || localNow.slice(11, 16) >= '15:00', '当日行情尚未收盘')
  const { start, end } = performanceWindow(history[0].date, latest.date, calendar)
  const points = history
  const expected = []
  for (let t = dateTimestamp(start); t <= dateTimestamp(end); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10)
    if (isTradingDay(day, calendar)) expected.push(day)
  }
  requireValue(points.length === expected.length && points.every((row, i) => row.date === expected[i]), '窗口行情缺失或含非交易日')
  requireValue(points.length >= 2, '收益样本不足')
  const returns = points.slice(1).map((point, i) => point.close / points[i].close - 1)
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const sampleStd = returns.length < 2 ? 0 : Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1))
  let peak = points[0]
  let maxDrawdown = 0
  let peakDate = null
  let troughDate = null
  for (const point of points) {
    if (point.close > peak.close) peak = point
    const drawdown = 1 - point.close / peak.close
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      peakDate = peak.date
      troughDate = point.date
    }
  }
  const calendarDays = (dateTimestamp(end) - dateTimestamp(start)) / DAY
  const annualReturn = (points.at(-1).close / points[0].close) ** (365 / calendarDays) - 1
  const sharpe = returns.length < 2 || sampleStd <= 1e-12 ? null : Math.sqrt(252) * mean / sampleStd
  requireValue([annualReturn, maxDrawdown, mean, sampleStd, ...returns].every(Number.isFinite) && (sharpe === null || Number.isFinite(sharpe)), '计算结果非有限数值')
  return {
    values: { annualReturn, maxDrawdown, sharpe },
    calculation: {
      windowMode: 'all_history', windowStart: start, windowEnd: end, calendarDays, priceCount: points.length, returnCount: returns.length,
      calendarVerified: true, calendarId: calendar.id, calendarSources: calendar.sources,
      annualizationSessions: 252, annualRiskFreeRate: 0, riskFreeMode: 'fixed_assumption',
      dailyMean: mean, dailySampleStd: sampleStd, drawdownPeakDate: peakDate, drawdownTroughDate: troughDate,
      inputSummary: { code: 'H30269', source: 'eastmoney', startClose: points[0].close, endClose: points.at(-1).close, historyCount: history.length, sourceUpdatedAt: market.updatedAt ?? null },
    },
  }
}

function metric(key, value, asOf, reason = null) {
  return { ...METRIC_DEFINITIONS[key], value, asOf, status: value === null ? 'unavailable' : 'ok', reason }
}

export function validateLatestMetrics(data) {
  requireValue(data?.schemaVersion === 1 && data.ruleVersion === RULE_VERSION && data.code === 'H30269', '最新指标版本或代码异常')
  requireValue(typeof data.generatedAt === 'string' && Number.isFinite(Date.parse(data.generatedAt)), '指标生成时间无效')
  for (const [key, definition] of Object.entries(METRIC_DEFINITIONS)) {
    const item = data.metrics?.[key]
    requireValue(item && Object.entries(definition).every(([k, v]) => item[k] === v), `指标元数据异常：${key}`)
    requireValue(['ok', 'stale', 'unavailable'].includes(item.status), `指标状态异常：${key}`)
    requireValue(item.reason === null || typeof item.reason === 'string', '指标原因无效')
    if (item.status === 'ok') requireValue(item.reason === null, '正常指标不应有失败原因')
    else requireValue(typeof item.reason === 'string' && item.reason.length > 0, '缺少指标失败原因')
    if (item.status === 'unavailable') requireValue(item.value === null, '缺失指标不能带数值')
    else requireValue(Number.isFinite(item.value) || (key === 'sharpe' && item.status === 'stale' && item.value === null), `指标数值异常：${key}`)
    if (item.value !== null) {
      requireValue(typeof item.asOf === 'string', '数值缺少日期')
      if (key === 'pe' || key === 'pb') requireValue(item.value > 0, '估值必须为正数')
      if (key === 'dividendYield' || key === 'maxDrawdown') requireValue(item.value >= 0 && item.value <= 1, '比例超出范围')
      if (key === 'annualReturn') requireValue(item.value > -1, '年化收益无效')
    }
    if (item.asOf !== null) validAsOf(item.asOf, data.generatedAt)
  }
  const calculation = data.calculation
  if (calculation !== null) {
    requireValue(calculation && calculation.calendarVerified === true && calculation.annualizationSessions === 252 && calculation.annualRiskFreeRate === 0 && calculation.riskFreeMode === 'fixed_assumption', '计算口径异常')
    const days = (dateTimestamp(calculation.windowEnd) - dateTimestamp(calculation.windowStart)) / DAY
    requireValue(calculation.windowMode === 'all_history' && days > 0 && days === calculation.calendarDays && Number.isInteger(calculation.priceCount) && calculation.priceCount >= 2 && calculation.returnCount === calculation.priceCount - 1, '计算窗口异常')
    requireValue(PERFORMANCE.every(key => data.metrics[key].asOf === calculation.windowEnd), '计算结果日期不一致')
    requireValue(typeof calculation.calendarId === 'string' && Array.isArray(calculation.calendarSources) && calculation.calendarSources.length > 0, '计算缺少日历来源')
    requireValue(Number.isFinite(calculation.dailyMean) && Number.isFinite(calculation.dailySampleStd) && calculation.dailySampleStd >= 0, '收益统计无效')
    const summary = calculation.inputSummary
    requireValue(summary?.historyCount === calculation.priceCount, '全部历史记录数不一致')
    requireValue(summary?.code === 'H30269' && summary.source === 'eastmoney' && [summary.startClose, summary.endClose].every(value => Number.isFinite(value) && value > 0), '计算输入摘要异常')
    requireValue(['annualReturn', 'maxDrawdown'].every(key => Number.isFinite(data.metrics[key].value)), '窗口缺少有效收益或回撤')
    const stale = PERFORMANCE.every(key => data.metrics[key].status === 'stale')
    const fresh = data.metrics.annualReturn.status === 'ok' && data.metrics.maxDrawdown.status === 'ok' && ['ok', 'unavailable'].includes(data.metrics.sharpe.status)
    requireValue(stale || fresh, '计算状态必须整体一致')
    for (const day of [calculation.drawdownPeakDate, calculation.drawdownTroughDate]) {
      if (day !== null) {
        dateTimestamp(day)
        requireValue(day >= calculation.windowStart && day <= calculation.windowEnd, '回撤日期超出窗口')
      }
    }
  } else requireValue(PERFORMANCE.every(key => data.metrics[key].value === null), '计算结果缺少窗口')
  return data
}

// inputErrors allows a future refresh orchestrator to report upstream failures even
// when the on-disk source snapshot was preserved. A merely older date is not failure.
export function buildLatestMetrics({ market, valuation, dividend, previous, inputErrors = {}, calendar = tradingCalendar, now = new Date() }) {
  let old = null
  try { old = validateLatestMetrics(previous) } catch { /* Never retain unvalidated output. */ }
  const metrics = {}
  let calculation = null
  const fail = (key, reason) => {
    const prior = old?.metrics[key]
    metrics[key] = prior?.value !== null && prior?.value !== undefined
      ? { ...prior, status: 'stale', reason }
      : metric(key, null, null, reason)
  }
  for (const key of ['pe', 'pb', 'dividendYield']) {
    try {
      const isDividend = key === 'dividendYield'
      const data = isDividend ? dividend : valuation
      if (inputErrors[isDividend ? 'dividend' : 'valuation']) throw new Error(inputErrors[isDividend ? 'dividend' : 'valuation'])
      requireValue(data?.code === 'H30269' && data.source === METRIC_DEFINITIONS[key].source && data.basis === METRIC_DEFINITIONS[key].basis, '指标来源或口径异常')
      requireValue(data.unit === (isDividend ? 'percent' : 'multiple') && (isDividend || data.provider === 'Eastmoney'), '指标单位或供应商异常')
      validAsOf(data.date, now)
      requireValue(!old?.metrics[key].asOf || data.date >= old.metrics[key].asOf, '指标日期倒退')
      const raw = isDividend ? data.value : data[key]
      requireValue(Number.isFinite(raw) && (isDividend ? raw >= 0 && raw <= 100 : raw > 0), '指标数值无效')
      metrics[key] = metric(key, isDividend ? raw / 100 : raw, data.date)
    } catch (error) { fail(key, error.message) }
  }
  try {
    if (inputErrors.market) throw new Error(inputErrors.market)
    const result = calculatePerformance(market, { now, calendar })
    requireValue(!old?.calculation || result.calculation.windowEnd >= old.calculation.windowEnd, '行情日期倒退')
    calculation = result.calculation
    for (const key of PERFORMANCE) metrics[key] = metric(key, result.values[key], calculation.windowEnd, result.values[key] === null ? '样本不足或波动为零' : null)
  } catch (error) {
    if (old?.calculation) {
      calculation = old.calculation
      for (const key of PERFORMANCE) metrics[key] = { ...old.metrics[key], status: 'stale', reason: error.message }
    } else for (const key of PERFORMANCE) fail(key, error.message)
  }
  return validateLatestMetrics({ schemaVersion: 1, ruleVersion: RULE_VERSION, code: 'H30269', generatedAt: new Date(now).toISOString(), metrics, calculation })
}

export function formatLatestMetric(item) {
  if (!Number.isFinite(item?.value)) return '—'
  const value = item.value * (item.unit === 'ratio' ? 100 : 1)
  const text = (Math.abs(value) < 0.005 ? 0 : value).toFixed(2)
  return `${text}${item.unit === 'ratio' ? '%' : item.unit === 'multiple' ? ' 倍' : ''}`
}
