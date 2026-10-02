import { validateMarketData } from './kline.js'
import { marketSummary } from './marketSummary.js'
import { ledgerDocument, localDate, portfolioSummary } from './portfolioLedger.js'
import { compareMembership, matchingSnapshot, validateConstituentHistory } from './constituentStructure.js'
import { dataFreshness } from './sourceStatus.js'
import { tradingCalendar } from '../data/tradingCalendar.js'

const moduleLabels = {
  '#market-chart': '行情', '#portfolio-ledger': '个人账本', '#observation-alerts': '观察提醒',
  '#valuation-analysis': '估值数据', '#yield-spread': '股息与国债差值', '#performance-metrics': '收益风险指标',
  '#index-comparison': '收益风险对比', '#constituent-structure': '成分数据', '#dividend-quality': '分红基本面',
  '#etf-income': 'ETF 分红', '#etf-nav-analysis': 'ETF 净值', '#data-source-status': '后台采集状态',
}

// The overview is a view of saved observations, never a new collection or an
// assumption that the latest deployed date equals today's trading session.
export function todayOverview({ instrument, states, entries = [], constituentInputs, moduleWarnings = [], now = new Date(), calendar = tradingCalendar }) {
  const today = localDate(now), issues = new Map()
  const addIssue = (target, label, message) => {
    if (!issues.has(target)) issues.set(target, { target, label: moduleLabels[target] ?? label, messages: [] })
    const messages = issues.get(target).messages
    if (!messages.includes(message)) messages.push(message)
  }
  const marketState = states[instrument] ?? {}, collection = states.collection ?? {}
  let market = null
  const price = { date: null, previousDate: null, close: null, change: null, changePercent: null, reason: '暂无已收盘行情' }
  try {
    if (marketState.data) {
      validateMarketData(marketState.data, instrument)
      if (marketState.data.source !== 'eastmoney' || marketState.data.latest.date > today) throw new Error('行情来源或日期异常')
      const closed = new Date(now.getTime() + 8 * 3600000).toISOString().slice(11, 16) >= '15:00'
      const history = marketState.data.history.filter(row => row.date < today || closed)
      if (history.length) {
        market = { ...marketState.data, history, latest: history.at(-1) }
        const summary = marketSummary(history, calendar)
        Object.assign(price, { date: summary.date, previousDate: summary.previousDate, close: market.latest.close,
          change: summary.change, changePercent: summary.changePercent, reason: summary.dailyReason })
        if (price.reason) addIssue('#market-chart', '行情', price.reason)
      } else price.reason = '当日尚未收盘，等待已收盘行情'
    }
  } catch (error) { price.reason = error.message; addIssue('#market-chart', '行情', error.message) }

  const portfolio = { applicable: instrument === '512890', hasEntries: entries.length > 0, date: price.date,
    previousDate: price.previousDate, totalProfit: null, change: null, reason: '' }
  if (portfolio.applicable && entries.length) {
    try {
      const valid = ledgerDocument(entries, { now }).entries
      if (!market) throw new Error('暂无已收盘行情，等待持仓估值')
      if (valid.some(entry => entry.date > market.latest.date)) throw new Error('账本有晚于行情的记录，等待行情更新')
      const current = portfolioSummary(valid, market.latest, { now })
      portfolio.totalProfit = current.totalProfit
      if (!price.previousDate || price.change === null) throw new Error(price.reason || '上一交易日行情待核验')
      const before = valid.filter(entry => entry.date <= price.previousDate)
      const quote = market.history.find(row => row.date === price.previousDate)
      // Before the first entry the personal profit baseline is zero. Once a
      // ledger exists we use the same cumulative accounting as its detail view.
      const baseline = before.length ? portfolioSummary(before, quote, { now }).totalProfit : 0
      if (baseline === null || current.totalProfit === null) throw new Error('持仓盈亏基准待核验')
      portfolio.change = current.totalProfit - baseline
    } catch (error) { portfolio.reason = error.message; addIssue('#portfolio-ledger', '个人账本', error.message) }
  }

  const constituents = { date: null, fromDate: null, observedAt: null, added: null, removed: null, renamed: null, industryChanges: null, reason: '尚未积累两次成分观察' }
  const historyState = states.constituentHistory ?? {}, currentState = states.constituents ?? {}
  const historyData = constituentInputs ? constituentInputs.history : historyState.data
  const currentData = constituentInputs ? constituentInputs.current : currentState.data
  try {
    if (historyData) {
      const history = validateConstituentHistory(historyData)
      if (history.snapshots.some(row => row.date > today || Date.parse(row.observedAt) > now.getTime())) throw new Error('成分观察日期晚于当前时间')
      const last = history.snapshots.at(-1)
      if (last) Object.assign(constituents, { date: last.date, observedAt: last.observedAt })
      if (currentData?.members.length && !matchingSnapshot(currentData, history)) addIssue('#constituent-structure', '成分数据', '当前名单与历史观察尚未同步')
      if (history.snapshots.length >= 2) {
        const event = compareMembership(history.snapshots.at(-2), last)
        Object.assign(constituents, { fromDate: event.fromDate, added: event.added.length, removed: event.removed.length,
          renamed: event.renamed.length, industryChanges: event.industryChanges.length, reason: '' })
      }
      if (history.membershipStatus !== 'ok') addIssue('#constituent-structure', '成分数据', history.membershipReason)
      if (history.industryStatus !== 'ok') addIssue('#constituent-structure', '成分数据', history.industryReason)
    }
  } catch (error) { constituents.reason = error.message; addIssue('#constituent-structure', '成分数据', error.message) }

  const sources = [
    [instrument, '行情', '#market-chart', instrument, 'market'],
    ['valuation', '估值', '#valuation-analysis', 'valuation', 'indicator'],
    ['dividend', '股息率', '#yield-spread', 'dividend', 'indicator'],
    ['treasury', '国债收益率', '#yield-spread', 'bond', 'indicator'],
    ['H30269', '标的指数行情', '#performance-metrics', 'H30269', 'market'],
    ['000300', '沪深300', '#index-comparison', '000300', 'market'],
    ['latestMetrics', '收益风险指标', '#performance-metrics'],
    ['eastmoneyHistory', '估值历史', '#valuation-analysis', 'valuation', 'indicator'],
    ['csiHistory', '中证估值历史', '#valuation-analysis', 'csiValuation', 'indicator'],
    ['csiStatus', '中证估值状态', '#valuation-analysis'],
    ['yieldHistory', '收益率历史', '#yield-spread', 'yieldHistory', 'indicator'],
    ['constituents', '成分名单', '#constituent-structure'],
    ['constituentHistory', '成分历史', '#constituent-structure'],
    ['fundamentals', '分红基本面', '#dividend-quality'],
    ...(instrument === '512890' ? [['etfDistributions', 'ETF 分红', '#etf-income'], ['etfNav', 'ETF 净值', '#etf-nav-analysis']] : []),
  ]
  const seen = new Set()
  for (const [key, label, target, source, kind] of sources) {
    if (seen.has(key)) continue
    seen.add(key)
    const state = states[key]
    if (!state?.attempted) continue
    if (state.error) addIssue(target, label, `${label}读取失败${state.data ? '，保留原值与日期' : '，暂无可用数据'}`)
    if (!state.loading && !state.data && !state.error) addIssue(target, label, `${label}暂无数据`)
    if (state.data && ['stale', 'partial', 'unavailable', 'error'].includes(state.data.status)) addIssue(target, label, state.data.reason || `${label}含保留值或不可用项`)
    if (source) {
      const entry = collection.data?.sources?.[source]
      if (entry?.status === 'error') addIssue(target, label, `${label}后台更新失败${collection.error ? '，当前状态未能重新核验' : ''}`)
      else if (!collection.loading && (collection.error || !entry)) addIssue(target, label, `${label}后台采集状态未知`)
    }
    if (state.data && (source || key === 'latestMetrics')) {
      const dates = key === 'yieldHistory'
        ? [['历史股息率', state.data.series?.dividend?.history.at(-1)?.date], ['历史国债收益率', state.data.series?.treasury?.history.at(-1)?.date]]
        : [[label, key === 'latestMetrics' ? state.data.calculation?.windowEnd : state.data.latest?.date ?? state.data.date]]
      for (const [dateLabel, date] of dates) {
        const freshness = dataFreshness(date, { now, kind: key === 'latestMetrics' ? 'market' : kind, calendar })
        if (freshness.level !== 'current') addIssue(target, label, `${dateLabel}：${freshness.text}${date ? `（${date}）` : ''}`)
      }
    }
  }
  if (collection.error) addIssue('#data-source-status', '后台采集状态', '采集状态文件读取失败，不能确认当前后台状态')
  for (const warning of moduleWarnings) if (warning.active) addIssue(warning.target, warning.label, warning.message)
  const loading = [...seen].some(key => states[key]?.loading) || Boolean(collection.loading)
  return { today, price, portfolio, constituents, issues: [...issues.values()], loading }
}
