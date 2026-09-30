import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { calculateEtfReturn, ETF_DISTRIBUTION_SOURCE, etfReturnHistory, validateEtfDistributions } from '../src/utils/etfDistributions.js'
import { getEtfDistributions } from '../src/api/etfDistributions.js'
import { parseEtfDistributions } from '../scripts/lib/etf-distributions.mjs'
import { refreshEtfDistributions } from '../scripts/fetch-etf-distributions.mjs'
import { etfReturnOption, etfReturnWindow } from '../src/charts/etfReturn.js'
import { initEtfReturn } from '../src/charts/etfReturnRuntime.js'
import { createDashboardData } from '../src/composables/useDashboardData.js'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

use([SVGRenderer])

const now = new Date('2026-09-30T12:00:00.000Z')
const snapshot = (patch = {}) => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', coverage: { start: '2018-12-19', end: '2026-09-30' }, checkedAt: now.toISOString(), status: 'ok', reason: null, dividends: [], splits: [], ...patch })
const event = (patch = {}) => ({ recordDate: '2026-09-28', exDate: '2026-09-29', payDate: '2026-10-09', cashPerShare: .1, ...patch })
const prices = (values, dates = ['2026-09-28', '2026-09-29', '2026-09-30']) => values.map((close, i) => ({ date: dates[i], close }))
const html = (cash = "<tr><td colspan='5'>暂无分红信息!</td></tr>", splits = '<tr><td>2021年</td><td>2021-10-22</td><td>份额分拆</td><td>1:2.0000</td></tr>') => `<title>红利低波ETF华泰柏瑞(512890)基金分红送配</title><table class='w782 cfxq'><thead><tr><th>年份</th><th>权益登记日</th><th>除息日</th><th>每10份分红</th><th>分红发放日</th></tr></thead><tbody>${cash}</tbody></table><table class='w782 fhxq'><tr><th>年份</th><th>拆分折算日</th><th>拆分类型</th><th>拆分折算比例</th></tr>${splits}</table>`
const cashRow = '<tr><td>2026年</td><td>2026-09-28</td><td>2026-09-29</td><td>每10份派现金1.0000元</td><td>2026-10-09</td></tr>'

test('明确未分红和份额拆分独立解析，每10份金额正确转换；结构、身份及单位不明则拒绝', () => {
  const data = parseEtfDistributions(html(), now)
  assert.deepEqual(data.dividends, [])
  assert.deepEqual(data.splits, [{ date: '2021-10-22', ratio: 2 }])
  assert.equal(data.coverage.end, '2026-09-30')
  assert.equal(parseEtfDistributions(html(cashRow), now).dividends[0].cashPerShare, .1)
  for (const bad of [html().replace('512890', '510880'), html().replace('cfxq', 'missing'), html().replace('每10份分红', '每份分红'), html(''), html('<tr><td>暂无数据</td></tr>'), html(cashRow.replace('每10份', '每份')), html(cashRow + cashRow), html(cashRow.replace('2026-09-29', '2026-02-30')), html(undefined, '<tr><td>2021年</td><td>2021-10-22</td><td>未知类型</td><td>1:2</td></tr>')]) {
    assert.throws(() => parseEtfDistributions(bad, now))
  }
})

test('现金持有收益在除息日确认，发放日前单列应收，不按基金净值或再投计算', () => {
  const data = snapshot({ dividends: [event()] })
  const result = calculateEtfReturn(prices([1, .9, .95]), data, { now })
  assert.equal(result.points[0].cash, 0)
  assert.equal(result.points[1].cash, .1)
  assert.ok(Math.abs(result.points[1].totalReturn) < 1e-12)
  assert.ok(Math.abs(result.current.totalReturn - .05) < 1e-12)
  assert.ok(Math.abs(result.current.priceReturn + .05) < 1e-12)
  assert.equal(result.received, 0)
  assert.equal(result.receivable, .1)
  const paid = calculateEtfReturn(prices([1, .9, .95]), snapshot({ dividends: [event({ payDate: '2026-09-30' })] }), { now })
  assert.equal(paid.received, .1)
  assert.equal(paid.receivable, 0)
  // Buying after record-day close does not earn a later ex-date dividend.
  assert.equal(calculateEtfReturn(prices([1, .9, .95]), snapshot({ dividends: [event({ recordDate: '2026-09-25' })] }), { now }).count, 0)
  // Buying at the ex-date close excludes that distribution from the baseline.
  assert.equal(calculateEtfReturn(prices([.9, .95], ['2026-09-29', '2026-09-30']), data, { now }).current.cash, 0)
})

test('多次分红与拆分使用登记日份额，现金不随后续拆分翻倍；未来事件不计入', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08']
  const data = snapshot({ dividends: [event({ recordDate: dates[0], exDate: dates[1], payDate: dates[2] }), event({ recordDate: dates[4], exDate: dates[5], payDate: '2026-10-09', cashPerShare: .05 }), event({ recordDate: '2026-10-10', exDate: '2026-10-12', payDate: '2026-10-15' })], splits: [{ date: dates[3], ratio: 2 }] })
  const result = calculateEtfReturn(prices([1, .9, .9, .45, .45, .4], dates), data, { now })
  assert.equal(result.current.shares, 2)
  assert.equal(result.current.cash, .2)
  assert.equal(result.received, .1)
  assert.equal(result.receivable, .1)
  assert.equal(result.count, 2)
  assert.ok(Math.abs(result.current.totalReturn) < 1e-12)
  assert.ok(Math.abs(result.points[3].priceReturn - result.points[2].priceReturn) < 1e-12)
  assert.equal(calculateEtfReturn(prices([.45, .4], dates.slice(4)), data, { now }).splits, 0)
  assert.throws(() => calculateEtfReturn(prices([1, .9, .95]), snapshot({ dividends: [event()], splits: [{ date: '2026-09-29', ratio: 2 }] }), { now }), /同日/)
})

test('分红不可用、核验不覆盖、坏数据和单样本不假报收益；stale 只使用原覆盖范围', () => {
  const market = prices([1, 1.1, 1.2])
  const noDividend = calculateEtfReturn(market, snapshot(), { now })
  assert.equal(noDividend.current.priceReturn, noDividend.current.totalReturn)
  for (const patch of [{ code: 'H30269' }, { unit: 'per10' }, { coverage: { start: '2018-12-19', end: '2026-10-01' } }, { checkedAt: 'invalid' }, { dividends: [event({ cashPerShare: -1 })] }, { dividends: [event(), event()] }, { splits: [{ date: '2021-10-22', ratio: 0 }] }]) assert.throws(() => validateEtfDistributions(snapshot(patch), { now }))
  assert.throws(() => calculateEtfReturn(market, snapshot({ status: 'unavailable', reason: '失败', coverage: null, checkedAt: null }), { now }), /不能按零分红/)
  const stale = snapshot({ status: 'stale', reason: '保留旧值' })
  assert.equal(calculateEtfReturn(market, stale, { now }).current.cash, 0)
  assert.throws(() => calculateEtfReturn([...market, { date: '2026-10-09', close: 1.3 }], stale, { now: new Date('2026-10-10') }), /未覆盖/)
  for (const rows of [[], market.slice(0, 1), [...market].reverse(), [market[0], market[0]], prices([1, 0]), prices([1, '1.1'])]) assert.throws(() => calculateEtfReturn(rows, snapshot(), { now }))
})

test('年初至今要求上一年末最后交易日；近一年按实际交易日基准，闰年回退及不足范围显式报错', () => {
  const history = prices([1, 1.1, 1.2, 1.3], ['2025-09-29', '2025-12-31', '2026-01-05', '2026-09-29'])
  assert.equal(etfReturnHistory(history, 'ytd')[0].date, '2025-12-31')
  assert.equal(etfReturnHistory(history, 'year')[0].date, '2025-09-29')
  assert.throws(() => etfReturnHistory(history.filter(row => row.date !== '2025-12-31'), 'ytd'), /缺少上年末/)
  assert.throws(() => etfReturnHistory(history.slice(2), 'year'), /未覆盖/)
  assert.equal(etfReturnHistory(prices([1, 1.2], ['2023-02-28', '2024-02-29']), 'year')[0].date, '2023-02-28')
})

test('采集失败或历史记录消失保留旧日期和数据；恢复清除失败；无旧值写 unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stock-etf-'))
  const output = join(directory, 'data.json'), options = { output, now, fetcher: async () => new Response(html(cashRow)) }
  try {
    const success = await refreshEtfDistributions(options)
    assert.equal(success.ok, true)
    const later = new Date('2026-10-01T12:00:00.000Z')
    const failed = await refreshEtfDistributions({ ...options, now: later, fetcher: async () => { throw new Error('offline') } })
    assert.equal(failed.ok, false)
    assert.equal(failed.data.status, 'stale')
    assert.equal(failed.data.coverage.end, '2026-09-30')
    assert.deepEqual(failed.data.dividends, success.data.dividends)
    assert.equal((await refreshEtfDistributions({ ...options, now: later, fetcher: async () => new Response(html()) })).ok, false)
    const restored = await refreshEtfDistributions({ ...options, now: later })
    assert.equal(restored.data.status, 'ok')
    assert.equal(restored.data.coverage.end, '2026-10-01')
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), restored.data)
    const empty = await refreshEtfDistributions({ output: join(directory, 'empty.json'), now, fetcher: async () => new Response('blocked', { status: 403 }) })
    assert.equal(empty.data.status, 'unavailable')
    assert.equal(empty.data.coverage, null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('分红快照 API 校验且共享请求；失败刷新保留原数据和日期', async () => {
  const data = snapshot()
  assert.equal((await getEtfDistributions({ fetcher: async () => Response.json(data) })).dividends.length, 0)
  await assert.rejects(getEtfDistributions({ fetcher: async () => new Response('', { status: 404 }) }))
  await assert.rejects(getEtfDistributions({ fetcher: async () => Response.json({ ...data, unit: 'wrong' }) }))
  let requests = 0, fail = false
  const store = createDashboardData({ etfDistributions: async () => { requests++; if (fail) throw new Error('offline'); return data } })
  await Promise.all([store.ensure('etfDistributions'), store.ensure('etfDistributions')])
  assert.equal(requests, 1)
  fail = true; await store.refresh(['etfDistributions'])
  assert.equal(store.states.etfDistributions.data.coverage.end, '2026-09-30')
  assert.equal(store.states.etfDistributions.error, 'offline')
})

test('收益三条线按百分比独立渲染且数据更新保留日期缩放，实际快照按核验范围计算', async () => {
  const stats = calculateEtfReturn(prices([1, .9, .95]), snapshot({ dividends: [event()] }), { now })
  const option = etfReturnOption(stats)
  assert.deepEqual(option.series.map(series => series.data.length), [3, 3, 3])
  assert.ok(Math.abs(option.series[2].data[2] - 5) < 1e-10)
  assert.equal(option.series[1].data[2], 10)
  const chart = initEtfReturn(null, { renderer: 'svg', ssr: true, width: 600, height: 310 })
  try { chart.setOption(option); assert.ok(chart.renderToSVGString().includes('含分红收益')); assert.equal(chart.getOption().series.length, 3) } finally { chart.dispose() }
  const updated = [{ date: '2026-09-25', close: 1 }, ...stats.points, { date: '2026-10-09', close: 1 }]
  assert.deepEqual(etfReturnWindow(stats.points, updated, { start: 50, end: 100 }), { startIndex: 2, endIndex: 3 })
  const data = JSON.parse(await readFile(new URL('../public/data/distributions-512890.json', import.meta.url), 'utf8'))
  const market = JSON.parse(await readFile(new URL('../public/data/512890.json', import.meta.url), 'utf8'))
  const calculationTime = new Date(Math.max(Date.parse(data.checkedAt) || 0, Date.parse(now)))
  if (data.status === 'unavailable' || market.history.at(-1).date > data.coverage.end) {
    assert.throws(() => calculateEtfReturn(market.history, data, { now: calculationTime }), /不能按零分红|未覆盖/)
    return
  }
  const actual = calculateEtfReturn(market.history, data, { now: calculationTime })
  const eligible = data.dividends.filter(event => event.recordDate >= actual.startDate && event.exDate > actual.startDate && event.exDate <= actual.endDate)
  const expectedCash = eligible.reduce((sum, event) => sum + event.cashPerShare * data.splits.filter(split => split.date > actual.startDate && split.date <= event.recordDate).reduce((shares, split) => shares * split.ratio, 1), 0)
  assert.equal(actual.count, eligible.length)
  assert.ok(Math.abs(actual.current.cash - expectedCash) < 1e-12)
  assert.ok(Math.abs(actual.current.totalReturn - actual.current.priceReturn - actual.current.cashReturn) < 1e-12)
})
