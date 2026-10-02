import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateConstituents, CONSTITUENTS_SOURCE } from '../src/api/constituents.js'
import { validateConstituentHistory, matchingSnapshot, INDUSTRY_SOURCE, INDUSTRY_BASIS } from '../src/utils/constituentStructure.js'
import { validateFundamentals, fundamentalYears, FUNDAMENTALS_SOURCE, DIVIDEND_REPORT, FINANCIAL_REPORT, FUNDAMENTALS_BASIS } from '../src/utils/dividendQuality.js'
import { fundamentalUrl, parseFundamentalReport } from './lib/fundamentals.mjs'

const ROOT = new URL('../public/data/', import.meta.url)
const loadJson = async path => JSON.parse(await readFile(path, 'utf8'))
async function save(path, data) {
  await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`
  try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n'); await rename(temp, path) }
  finally { await rm(temp, { force: true }) }
}
export async function refreshFundamentals({ output = new URL('fundamentals-h30269.json', ROOT), membership = new URL('constituents-h30269.json', ROOT), membershipHistory = new URL('constituents-history-h30269.json', ROOT), fetcher = fetch, now = new Date(), concurrency = 3 } = {}) {
  const path = output instanceof URL ? fileURLToPath(output) : resolve(output), stamp = now.toISOString(), years = fundamentalYears(now)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error('基本面采集并发设置异常')
  let old = null
  try { old = validateFundamentals(await loadJson(path), { now }) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const metadata = { schemaVersion: 1, code: 'H30269', provider: 'Eastmoney', source: FUNDAMENTALS_SOURCE, dividendReport: DIVIDEND_REPORT, financialReport: FINANCIAL_REPORT, basis: FUNDAMENTALS_BASIS, currency: 'CNY', unit: 'CNY', years, membershipSource: CONSTITUENTS_SOURCE, industrySource: INDUSTRY_SOURCE, industryBasis: INDUSTRY_BASIS, lastAttemptAt: stamp }
  let current
  try {
    current = validateConstituents(await loadJson(membership))
    if (current.status === 'unavailable') throw new Error('成分股名单不可用')
    if (old?.membershipDate && current.date < old.membershipDate) throw new Error('成分股名单日期倒退')
  } catch (error) {
    const data = old && old.status !== 'unavailable' ? { ...old, status: 'stale', reason: '名单读取失败，保留原名单与基本面数据', membershipStatus: 'stale', membershipReason: error.message, lastAttemptAt: stamp } : { ...metadata, status: 'unavailable', reason: '成分股名单不可用，尚无基本面记录', membershipStatus: 'unavailable', membershipReason: error.message, membershipDate: null, members: [] }
    validateFundamentals(data, { now }); await save(path, data); return { ok: false, data, errors: [error.message] }
  }
  let matched = null
  try { matched = matchingSnapshot(current, validateConstituentHistory(await loadJson(membershipHistory))) } catch { /* Fundamentals remain usable without industry coverage. */ }
  const oldMembers = new Map((old?.members ?? []).map(member => [`${member.exchange}:${member.code}`, member]))
  const members = new Array(current.members.length), errors = [], deadline = performance.now() + 180000
  let cursor = 0
  async function collect(member, kind) {
    const previous = oldMembers.get(`${member.exchange}:${member.code}`)?.[kind]
    try {
      const remaining = Math.ceil(deadline - performance.now())
      if (remaining <= 0) throw new Error('本轮采集时间已到，保留待重试')
      const response = await fetcher(fundamentalUrl(member, kind, years), { signal: AbortSignal.timeout(Math.min(20000, remaining)), headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://data.eastmoney.com/' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const history = parseFundamentalReport(await response.json(), member, kind, years, now)
      const retained = (previous?.history ?? []).filter(row => years.includes(row.year))
      if (previous?.status !== 'unavailable' && retained.some(row => !history.some(item => item.year === row.year))) throw new Error('已保存年度消失，需核验来源')
      return { status: 'ok', reason: null, lastAttemptAt: stamp, lastSuccessAt: stamp, history }
    } catch (error) {
      errors.push(`${member.code} ${kind}: ${error.message}`)
      return previous && previous.status !== 'unavailable' ? { ...previous, history: previous.history.filter(row => years.includes(row.year)), status: 'stale', reason: '采集失败，保留原数据及成功时间', lastAttemptAt: stamp } : { status: 'unavailable', reason: '采集失败，尚无有效记录', lastAttemptAt: stamp, lastSuccessAt: null, history: [] }
    }
  }
  async function worker() {
    while (cursor < current.members.length) {
      const index = cursor++, member = current.members[index]
      const classified = matched?.members.find(value => value.exchange === member.exchange && value.code === member.code)
      // Complete each member independently so one failed source cannot erase the others.
      const dividends = await collect(member, 'dividends'), financials = await collect(member, 'financials')
      members[index] = { ...member, industry: classified?.industry ?? null, industryStatus: classified?.industryStatus ?? 'unavailable', industryDate: classified?.industryDate ?? null, industrySourceIndex: classified?.industrySourceIndex ?? null, dividends, financials }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, current.members.length) }, worker))
  const data = { ...metadata, status: errors.length || current.status !== 'ok' ? 'partial' : 'ok', reason: errors.length ? `${errors.length} 个个股来源更新失败，保留可用数据` : current.status !== 'ok' ? current.reason : null,
    membershipDate: current.date, membershipStatus: current.status, membershipReason: current.status === 'ok' ? null : current.reason, members }
  validateFundamentals(data, { now }); await save(path, data)
  return { ok: data.status === 'ok', data, errors }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await refreshFundamentals()
  console.log(`H30269 fundamentals: ${result.data.members.length} members, ${result.data.years.join('–')}, ${result.data.status}`)
  for (const error of result.errors) console.error(error)
  process.exitCode = result.ok ? 0 : 1
}
