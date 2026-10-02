import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateFundamentals, analyzeDividendQuality, fundamentalYears, FUNDAMENTALS_SOURCE, DIVIDEND_REPORT, FINANCIAL_REPORT, FUNDAMENTALS_BASIS } from '../src/utils/dividendQuality.js'
import { INDUSTRY_SOURCE, INDUSTRY_BASIS } from '../src/utils/constituentStructure.js'
import { CONSTITUENTS_SOURCE } from '../src/api/constituents.js'
import { getFundamentals } from '../src/api/fundamentals.js'
import { fundamentalUrl, parseFundamentalReport } from '../scripts/lib/fundamentals.mjs'
import { refreshFundamentals } from '../scripts/fetch-fundamentals.mjs'

const now = new Date('2026-10-02T08:00:00.000Z'), stamp = now.toISOString(), years = [2021, 2022, 2023, 2024, 2025]
function fixture() {
  const members = Array.from({ length: 50 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `证券${i + 1}`, exchange: 'SZSE', industry: '工业', industryStatus: 'ok', industrySourceIndex: '932079', industryDate: '2026-09-30',
    dividends: { status: 'ok', reason: null, lastAttemptAt: stamp, lastSuccessAt: stamp, history: years.map(year => ({ year, reportDate: `${year}-12-31`, cashDividend: 10, plannedDividend: 10 })) },
    financials: { status: 'ok', reason: null, lastAttemptAt: stamp, lastSuccessAt: stamp, history: years.map(year => ({ year, reportDate: `${year}-12-31`, noticeDate: `${year + 1}-04-01`, updatedDate: '2026-04-01', parentProfit: 30, operatingCashFlow: 20, roe: 10, orgType: '通用' })) } }))
  return { schemaVersion: 1, code: 'H30269', provider: 'Eastmoney', source: FUNDAMENTALS_SOURCE, dividendReport: DIVIDEND_REPORT, financialReport: FINANCIAL_REPORT, basis: FUNDAMENTALS_BASIS, currency: 'CNY', unit: 'CNY', years, lastAttemptAt: stamp, status: 'ok', reason: null, membershipSource: CONSTITUENTS_SOURCE, industrySource: INDUSTRY_SOURCE, industryBasis: INDUSTRY_BASIS, membershipDate: '2026-09-30', membershipStatus: 'ok', membershipReason: null, members }
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
const analyze = (data, year = 2025) => analyzeDividendQuality(data, year, { now })
const raw = (data, member, kind) => {
  const rows = member[kind].history.map(row => ({ SECURITY_CODE: member.code, SECUCODE: `${member.code}.SZ`, REPORT_DATE: row.reportDate + ' 00:00:00',
    ...(kind === 'dividends' ? { DIVIDEND_IMPLE: row.cashDividend, DIVIDEND_PLAN: row.plannedDividend } : { CURRENCY: 'CNY', ORG_TYPE: row.orgType, NOTICE_DATE: row.noticeDate + ' 00:00:00', UPDATE_DATE: row.updatedDate + ' 00:00:00', PARENTNETPROFIT: row.parentProfit, NETCASH_OPERATE_PK: row.operatingCashFlow, ROEJQ: row.roe }) }))
  return { success: true, code: 0, result: { pages: 1, count: rows.length, data: rows } }
}

test('annual totals, payout and coverage use same fiscal year; company/industry contributions share the covered denominator', () => {
  const data = fixture(), first = data.members[0]
  first.dividends.history.at(-1).cashDividend = 20; first.dividends.history.at(-1).plannedDividend = 20
  first.industry = null; first.industryStatus = 'unavailable'; first.industrySourceIndex = null; first.industryDate = null
  const a = analyze(data), row = a.rows[0]
  near(a.totalDividend, 510); near(a.comparableGrowth, .02); near(row.growth, 1); near(row.change, 10)
  near(row.current.payoutRatio, 2 / 3); near(row.current.profitCoverage, 1.5); near(row.current.cashCoverage, 1)
  near(row.dividendShare, 20 / 510); near(a.groups.find(g => g.industry === null).share, 20 / 510)
  near(a.groups.reduce((sum, group) => sum + group.share, 0), 1)
  assert.equal(a.continuous, 50); assert.equal(a.continuityKnown, 50); assert.equal(a.changeCounts.increase, 1)
  assert.equal(a.rows[0].streak, 5)
  assert.equal(analyze(data, 2021).rows[0].windowYears, 1)
  assert.equal(analyze(data, 2021).comparableGrowth, null)
})

test('missing year never becomes zero or a nonadjacent growth base; continuity stops at gaps and labels a lower bound', () => {
  const data = fixture(), m = data.members[0]
  m.dividends.history = m.dividends.history.filter(row => row.year !== 2024)
  const row = analyze(data).rows[0]
  assert.equal(row.streak, 1); assert.equal(row.streakUnknown, true); assert.equal(row.continuous, null)
  assert.equal(row.growth, null); assert.equal(row.change, null); assert.equal(row.changeKind, 'unknown')
  assert.equal(analyze(data).continuityKnown, 49)
  m.dividends.history.find(row => row.year === 2023).cashDividend = 0
  assert.equal(analyze(data, 2023).rows[0].continuous, false)
})

test('zero dividend, resumption, pending implementation, negative earnings and negative cash retain distinct meanings', () => {
  const data = fixture(), m = data.members[0], d = m.dividends.history, f = m.financials.history
  d.at(-2).cashDividend = 0; d.at(-2).plannedDividend = 0
  let row = analyze(data).rows[0]; assert.equal(row.changeKind, 'resumed'); assert.equal(row.growth, null)
  d.at(-1).cashDividend = 0; d.at(-1).plannedDividend = 0
  row = analyze(data).rows[0]; assert.equal(row.changeKind, 'zero'); assert.equal(row.current.profitCoverage, null); assert.equal(row.current.cashCoverage, null)
  assert.equal(row.streak, 0); assert.equal(row.continuous, false)
  d.at(-2).cashDividend = 10; d.at(-2).plannedDividend = 10; d.at(-1).cashDividend = 5; d.at(-1).plannedDividend = 10
  assert.equal(analyze(data).rows[0].changeKind, 'pending'); assert.equal(analyze(data).comparable, 49); assert.equal(analyze(data).changeCounts.decrease, 0)
  d.at(-1).plannedDividend = 5; f.at(-1).parentProfit = -2; f.at(-1).operatingCashFlow = -3
  row = analyze(data).rows[0]; near(row.current.profitCoverage, -.4); near(row.current.cashCoverage, -.6); assert.equal(row.current.payoutRatio, null)
  assert.equal(row.changeKind, 'decrease'); near(row.growth, -.5); assert.match(row.current.coverageReason, /非正/)
})

test('financial companies show raw cash flow but are excluded from generic cash coverage; no usable amount leaves totals unknown', () => {
  const data = fixture()
  data.members[0].financials.history.at(-1).orgType = '银行'
  data.members[1].industry = '金融'; data.members[1].industrySourceIndex = '932083'
  const a = analyze(data)
  assert.equal(a.financialCount, 2); assert.equal(a.cashKnown, 48); assert.equal(a.cashCovered, 48)
  assert.equal(a.rows[0].current.operatingCashFlow, 20); assert.equal(a.rows[0].current.cashCoverage, null)
  assert.match(a.rows[0].current.cashReason, /金融企业/)
  for (const member of data.members) member.dividends.history.at(-1).cashDividend = null
  const empty = analyze(data)
  assert.equal(empty.covered, 0); assert.equal(empty.totalDividend, null); assert.equal(empty.comparableGrowth, null)
  assert.ok(empty.rows.every(row => row.dividendShare === null)); assert.ok(empty.groups.every(group => group.share === null))
})

test('snapshot validation rejects identity, currency, future dates, duplicate members/years, malformed status and false success', () => {
  const data = fixture(); assert.equal(validateFundamentals(data, { now }), data)
  for (const modify of [d => { d.code = '512890' }, d => { d.currency = 'HKD' }, d => { d.membershipDate = '2027-01-01' }, d => { d.members[1].code = d.members[0].code }, d => { d.members[0].dividends.history[1].year = 2021 }, d => { d.members[0].dividends.history[0].cashDividend = -1 }, d => { d.members[0].financials.history[0].parentProfit = Infinity }, d => { d.members[0].financials.history[0].noticeDate = '2026-10-03' }, d => { d.members[0].dividends.status = 'stale' }, d => { d.years[4] = 2026 }]) {
    const bad = structuredClone(data); modify(bad); assert.throws(() => validateFundamentals(bad, { now }))
  }
  const missing = structuredClone(data); missing.members[0].dividends = { status: 'unavailable', reason: 'offline', history: [], lastAttemptAt: stamp, lastSuccessAt: null }
  assert.throws(() => validateFundamentals(missing, { now }), /成功状态/)
  missing.status = 'partial'; missing.reason = 'offline'; assert.equal(analyze(missing).staleSources, 1)
  assert.throws(() => analyze(data, 2020), /年度不可用/)
  assert.deepEqual(fundamentalYears(new Date('2027-01-01T00:00:00Z')), [2022, 2023, 2024, 2025, 2026])
})

test('provider parser verifies exchange and currency, preserves nulls, rejects duplicate and partial data and selects annual reports only', () => {
  const data = fixture(), member = data.members[0]
  const p = raw(data, member, 'financials')
  p.result.data[0].PARENTNETPROFIT = null
  p.result.data.push({ ...p.result.data[0], REPORT_DATE: '2021-06-30 00:00:00' }); p.result.count++
  const parsed = parseFundamentalReport(p, member, 'financials', years, now)
  assert.equal(parsed.length, 5); assert.equal(parsed[0].parentProfit, null)
  for (const modify of [p => { p.success = false }, p => { p.result.pages = 2 }, p => { p.result.count++ }, p => { p.result.data[0].SECUCODE = '000001.SH' }, p => { p.result.data[0].CURRENCY = 'HKD' }, p => { p.result.data[0].PARENTNETPROFIT = '30' }, p => { p.result.data[0].NOTICE_DATE = '2020-01-01' }, p => { p.result.data[1].REPORT_DATE = p.result.data[0].REPORT_DATE }]) {
    const bad = structuredClone(p); modify(bad); assert.throws(() => parseFundamentalReport(bad, member, 'financials', years, now))
  }
  const url = fundamentalUrl(member, 'dividends', years)
  assert.equal(url.searchParams.get('reportName'), DIVIDEND_REPORT); assert.match(url.searchParams.get('filter'), /000001.SZ/)
})

test('collector retains failures per stock/source, rejects lost history and corrupt local files; missing membership preserves captured cohort', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stock-fundamentals-'))
  const output = join(dir, 'fundamentals.json'), membership = join(dir, 'members.json'), membershipHistory = join(dir, 'history.json'), data = fixture()
  try {
    const current = { schemaVersion: 1, code: 'H30269', source: CONSTITUENTS_SOURCE, status: 'ok', count: 50, date: data.membershipDate, members: data.members.map(({ code, name, exchange }) => ({ code, name, exchange })) }
    await writeFile(membership, JSON.stringify(current))
    let fail = false, regress = false, malformed = false
    const fetcher = async url => {
      const code = url.searchParams.get('filter').match(/(\d{6})\.SZ/)[1], kind = url.searchParams.get('reportName') === DIVIDEND_REPORT ? 'dividends' : 'financials'
      if (fail && code === '000001' && kind === 'dividends') throw new Error('offline')
      const payload = raw(data, data.members.find(m => m.code === code), kind)
      if (regress && code === '000002') { payload.result.data.shift(); payload.result.count-- }
      if (malformed && code === '000003' && kind === 'financials') payload.result.data[0].NOTICE_DATE = '2020-01-01'
      return Response.json(payload)
    }
    const first = await refreshFundamentals({ output, membership, membershipHistory, fetcher, now })
    assert.equal(first.ok, true); assert.equal(first.data.members[0].industry, null)
    fail = true; regress = true; malformed = true
    const later = new Date('2026-10-03T08:00:00.000Z')
    const second = await refreshFundamentals({ output, membership, membershipHistory, fetcher, now: later })
    assert.equal(second.ok, false); assert.equal(second.data.status, 'partial'); assert.equal(second.errors.length, 4)
    const saved = second.data.members[0]
    assert.equal(saved.dividends.status, 'stale'); assert.equal(saved.dividends.lastSuccessAt, stamp); assert.equal(saved.dividends.lastAttemptAt, later.toISOString())
    assert.deepEqual(saved.dividends.history, first.data.members[0].dividends.history); assert.equal(saved.financials.status, 'ok')
    assert.equal(second.data.members[2].financials.status, 'stale')
    assert.equal(second.data.members[3].dividends.status, 'ok')
    await rm(membership)
    const lostMembership = await refreshFundamentals({ output, membership, membershipHistory, fetcher, now: later })
    assert.equal(lostMembership.data.status, 'stale'); assert.deepEqual(lostMembership.data.members, second.data.members)
    await writeFile(output, '{broken'); await assert.rejects(refreshFundamentals({ output, membership, membershipHistory, fetcher, now: later }))
    assert.equal(await readFile(output, 'utf8'), '{broken')
    await rm(output)
    const unavailable = await refreshFundamentals({ output, membership, membershipHistory, fetcher, now: later })
    assert.equal(unavailable.data.status, 'unavailable'); assert.equal(unavailable.data.members.length, 0)
  } finally { for (const file of [output, membership, membershipHistory]) await rm(file, { force: true }); await rmdir(dir) }
})

test('snapshot API validates static data; real archived totals and ratios match independent annual lookup', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/fundamentals-h30269.json', import.meta.url), 'utf8'))
  const result = await getFundamentals({ fetcher: async (url, init) => { assert.match(url, /fundamentals-h30269.json\?t=/); assert.equal(init.cache, 'no-store'); return Response.json(data) } })
  assert.deepEqual(result, data)
  await assert.rejects(getFundamentals({ fetcher: async () => new Response('', { status: 500 }) }), /读取失败/)
  await assert.rejects(getFundamentals({ fetcher: async () => Response.json({ ...data, currency: 'USD' }) }), /单位/)
  for (const year of data.years) {
    const a = analyzeDividendQuality(data, year, { now: new Date(data.lastAttemptAt) })
    const independent = data.members.map(m => m.dividends.history.find(r => r.year === year)?.cashDividend).filter(Number.isFinite).reduce((sum, amount) => sum + amount, 0)
    near(a.totalDividend, independent)
    assert.equal(a.total, 50); near(a.groups.reduce((sum, group) => sum + group.share, 0), 1)
    for (const row of a.rows) if (row.current.payoutRatio !== null) near(row.current.payoutRatio, row.current.cashDividend / row.current.parentProfit)
  }
})
