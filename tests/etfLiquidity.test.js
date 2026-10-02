import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { calculateEtfLiquidity, estimateEtfCost, validateEtfFees, validateEtfSize } from '../src/utils/etfLiquidity.js'
import { parseEtfSize } from '../scripts/lib/etf-size.mjs'
import { refreshEtfSize } from '../scripts/fetch-etf-size.mjs'
import { getEtfFees, getEtfSize } from '../src/api/etfLiquidity.js'
import { etfLiquidityOption } from '../src/charts/etfLiquidity.js'
const now = new Date('2026-10-02T15:00:00Z')
const read = async name => JSON.parse(await readFile(new URL(`../public/data/${name}-512890.json`, import.meta.url), 'utf8'))
const market = () => readFile(new URL('../public/data/512890.json', import.meta.url), 'utf8').then(JSON.parse)
const source = (dates = ['2026-03-31', '2026-06-30'], amounts = [311.87, 312.9]) => `var fS_code="512890";var Data_fluctuationScale=${JSON.stringify({ categories: dates, series: amounts.map(y => ({ y })) })};`

test('成交额沿用元、换手率沿用百分数，真实最新和 20 日均值与原快照一致', async () => {
  const data = await market(), stats = calculateEtfLiquidity(data, { now })
  const tail = data.history.slice(-20)
  assert.equal(stats.current.amount, 990179269); assert.equal(stats.current.turnover, 3.22)
  assert.equal(stats.current.amount20, tail.reduce((sum, row) => sum + row.amount, 0) / 20)
  assert.equal(stats.current.turnover20, tail.reduce((sum, row) => sum + row.turnover, 0) / 20)
  assert.equal(stats.amountCount, stats.count); assert.equal(stats.missingSessions, 0)
  assert.equal(stats.minimum.date, '2026-09-29'); assert.equal(stats.maximum.date, '2026-08-05')
  const option = etfLiquidityOption(stats)
  assert.equal(option.series[0].data.at(-1), 9.90179269)
  assert.equal(option.series[2].data.at(-1), 3.22)
  assert.deepEqual(option.dataZoom[0].xAxisIndex, [0, 1])
})
test('缺字段、缺交易日不补零，20 日窗口不跨缺日缩短，真实零成交保留', async () => {
  const data = await market(), missing = data.history.at(-3).date
  data.history = data.history.filter(row => row.date !== missing)
  delete data.history.at(-2).amount
  data.history.at(-1).amount = 0; data.latest = { ...data.history.at(-1) }
  const stats = calculateEtfLiquidity(data, { range: '30d', now })
  assert.equal(stats.current.amount, 0); assert.equal(stats.zeroAmountDays, 1)
  assert.equal(stats.missingAmount, 2); assert.equal(stats.missingTurnover, 1); assert.equal(stats.missingSessions, 1)
  assert.equal(stats.current.amount20, null); assert.equal(stats.current.turnover20, null)
  assert.equal(stats.minimum.amount, 0)
  assert.equal(etfLiquidityOption(stats).series[0].data[stats.points.findIndex(row => row.date === missing)], null)
  assert.ok(stats.averageAmount > 0)
})
test('区间按交易日历对齐并在区间前预热，年初至今不含上年成交，开盘前排除当日', async () => {
  const data = await market()
  const custom = calculateEtfLiquidity(data, { range: 'custom', start: '2026-09-26', end: '2026-09-30', now })
  assert.equal(custom.startDate, '2026-09-28'); assert.equal(custom.count, 3); assert.ok(custom.points[0].amount20 > 0)
  const ytd = calculateEtfLiquidity(data, { range: 'ytd', now }); assert.ok(ytd.startDate >= '2026-01-01')
  assert.equal(calculateEtfLiquidity(data, { now: new Date('2026-09-30T06:00:00Z') }).endDate, '2026-09-29')
  assert.throws(() => calculateEtfLiquidity(data, { range: 'custom', start: '2026-09-30', end: '2026-09-29', now }), /不能晚于/)
  assert.throws(() => calculateEtfLiquidity(data, { range: 'custom', start: '2026-09-30', end: '2026-10-09', now }), /截止日/)
  assert.throws(() => calculateEtfLiquidity(data, { range: 'custom', start: '2026-09-26', end: '2026-09-27', now }), /没有可用/)
  assert.throws(() => calculateEtfLiquidity({ ...data, code: 'H30269' }, { now }), /格式异常/)
})
test('缺全部成交字段仍显示不可用，历史截短说明起点且不足 20 日不估均额', async () => {
  const data = await market(); data.history = data.history.slice(-3).map(({ amount, turnover, ...row }) => row); data.latest = data.history.at(-1)
  const stats = calculateEtfLiquidity(data, { now })
  assert.equal(stats.clipped, true); assert.equal(stats.count, 3)
  assert.equal(stats.averageAmount, null); assert.equal(stats.totalAmount, null); assert.equal(stats.averageTurnover, null)
  assert.equal(stats.minimum, null); assert.equal(stats.amountVs20, null); assert.equal(stats.current.amount20, null)
})
test('规模只解析 JSON，不执行脚本，亿元正确转元且拒绝未知身份、未来与重复报告', () => {
  const size = parseEtfSize(source(), now)
  assert.equal(size.date, '2026-06-30'); assert.equal(size.history[1].netAssets, 31290000000)
  assert.equal(etfLiquidityOption(size, 'size').series[0].data[1], 312.9)
  assert.throws(() => parseEtfSize(source().replace('512890', '007466'), now), /身份异常/)
  assert.throws(() => parseEtfSize(source() + source(), now), /重复/)
  assert.throws(() => parseEtfSize(source(['2026-06-30', '2026-06-30']), now), /重复/)
  assert.throws(() => parseEtfSize(source(['2026-03-31', '2027-06-30']), now), /未来/)
  assert.throws(() => parseEtfSize(source().replace('312.9', '"312.9"'), now), /数值异常/)
  assert.throws(() => parseEtfSize(source().replace('312.9', '(()=>{throw new Error("ran")})()'), now), SyntaxError)
})
test('规模与费率验证单位、日期、状态和成功时间，不能将联接基金费用混入 ETF', async () => {
  const size = await read('size'), fees = await read('fees')
  validateEtfSize(size, { now }); validateEtfFees(fees, { now })
  for (const value of [{ ...size, unit: '100M_CNY' }, { ...size, date: '2026-03-31' }, { ...size, lastSuccessAt: null }, { ...size, status: 'unavailable' }]) assert.throws(() => validateEtfSize(value, { now }))
  for (const value of [{ ...fees, code: '007466' }, { ...fees, unit: 'percent' }, { ...fees, management: .5 }, { ...fees, verifiedDate: '2027-01-01' }, { ...fees, source: 'https://example.com/' }]) assert.throws(() => validateEtfFees(value, { now }))
})
test('等额两笔佣金按最低收费计算，管理托管估算不计入佣金，成交占比不跨缺均额估算', async () => {
  const fees = await read('fees'), input = { amount: 10000, commissionBps: 1, minimumCommission: 5, days: 365 }
  assert.deepEqual(estimateEtfCost(input, fees, 100000000), { perOrder: 5, equalRoundTrip: 10, managementCustody: 60, participation: .0001 })
  assert.equal(estimateEtfCost({ ...input, amount: 100000 }, fees, null).perOrder, 10)
  assert.equal(estimateEtfCost({ ...input, commissionBps: 0, minimumCommission: 0, days: 0 }, fees, 0).equalRoundTrip, 0)
  assert.equal(estimateEtfCost(input, fees, 0).participation, null)
  for (const change of [{ amount: -1 }, { commissionBps: NaN }, { minimumCommission: -1 }, { days: 1.5 }, { amount: Infinity }]) assert.throws(() => estimateEtfCost({ ...input, ...change }, fees, 1e8), /成本假设/)
})
test('规模采集合并滚动窗口与同报告期修订，失败和日期倒退保留历史与成功时间', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stock-size-')), output = join(directory, 'size.json')
  try {
    const fetcher = text => async () => new Response(text)
    const first = await refreshEtfSize({ output, fetcher: fetcher(source()), now }); assert.equal(first.ok, true)
    const next = await refreshEtfSize({ output, fetcher: fetcher(source(['2026-06-30', '2026-09-30'], [313, 320])), now: new Date('2026-10-03T15:00:00Z') })
    assert.equal(next.data.history.length, 3); assert.equal(next.data.history[1].netAssets, 313e8)
    const failed = await refreshEtfSize({ output, fetcher: async () => { throw new Error('offline') }, now: new Date('2026-10-04T15:00:00Z') })
    assert.equal(failed.ok, false); assert.equal(failed.data.status, 'stale'); assert.deepEqual(failed.data.history, next.data.history); assert.equal(failed.data.lastSuccessAt, next.data.lastSuccessAt)
    const rollback = await refreshEtfSize({ output, fetcher: fetcher(source()), now: new Date('2026-10-05T15:00:00Z') })
    assert.equal(rollback.ok, false); assert.match(rollback.error, /倒退/); assert.equal(rollback.data.date, '2026-09-30')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('规模首次失败写不可用状态，损坏本地档案不覆盖', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stock-size-bad-')), output = join(directory, 'size.json')
  try {
    const result = await refreshEtfSize({ output, fetcher: async () => new Response('', { status: 503 }), now })
    assert.equal(result.data.status, 'unavailable'); assert.equal(result.data.date, null); assert.deepEqual(result.data.history, [])
    await writeFile(output, '{bad')
    await assert.rejects(refreshEtfSize({ output, fetcher: async () => new Response(source()), now }))
    assert.equal(await readFile(output, 'utf8'), '{bad')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('API 拒绝异常快照或读取失败，不回退假规模与费率', async () => {
  await assert.rejects(getEtfSize({ fetcher: async () => new Response('', { status: 404 }) }), /规模读取失败/)
  await assert.rejects(getEtfFees({ fetcher: async () => Response.json({ management: 0 }) }), /身份/)
  assert.equal((await getEtfSize({ fetcher: async () => Response.json(await read('size')) })).date, '2026-06-30')
  assert.equal((await getEtfFees({ fetcher: async () => Response.json(await read('fees')) })).management, .005)
})
