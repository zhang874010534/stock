import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CONSTITUENTS_SOURCE } from '../src/api/constituents.js'
import { getConstituentHistory } from '../src/api/constituentHistory.js'
import { INDUSTRY_SOURCE, INDUSTRY_BASIS, validateConstituentHistory, industryDistribution, compareMembership, matchingSnapshot, membershipTimeline, compareConstituentObservations } from '../src/utils/constituentStructure.js'

export function fixture() {
  const observedAt = '2026-09-24T10:00:00Z'
  const members = Array.from({ length: 50 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `股票${i + 1}`, exchange: 'SZSE', industry: i < 30 ? '金融' : null,
    industryStatus: i < 30 ? 'ok' : 'unavailable', industryDate: i < 30 ? '2026-09-24' : null, industrySourceIndex: i < 30 ? '932083' : null, industryObservedAt: i < 30 ? observedAt : null }))
  return { schemaVersion: 1, code: 'H30269', source: CONSTITUENTS_SOURCE, industrySource: INDUSTRY_SOURCE, industryBasis: INDUSTRY_BASIS, membershipStatus: 'ok', membershipReason: null, industryStatus: 'partial', industryReason: '20只未分类', lastAttemptAt: observedAt, snapshots: [{ date: '2026-09-24', observedAt, members }] }
}

test('区间对比保留两端分类，数量占比各用完整名单分母；行业消失、未分类和分类补充不算调样', () => {
  const member = (code, industry, name = code) => ({ code, name, exchange: 'SZSE', industry })
  const before = { date: '2026-09-24', observedAt: '2026-09-24T10:00:00Z', members: [member('000001', '金融'), member('000002', '工业'), member('000003', null)] }
  const after = { date: '2026-09-28', observedAt: '2026-09-28T10:00:00Z', members: [member('000001', '金融', '新名称'), member('000003', '能源'), member('000004', null), member('000005', '金融')] }
  const result = compareConstituentObservations(before, after)
  assert.equal(result.added.length, 2); assert.equal(result.removed.length, 1); assert.equal(result.retainedCount, 2)
  assert.equal(result.removed[0].industry, '工业'); assert.equal(result.added[0].industry, null)
  const finance = result.groups.find(group => group.industry === '金融')
  assert.equal(finance.beforeCount, 1); assert.equal(finance.afterCount, 2); assert.equal(finance.change, 1)
  assert.equal(finance.beforeShare, 1 / 3); assert.equal(finance.afterShare, .5)
  assert.ok(Math.abs(finance.shareChange - 100 / 6) < 1e-12)
  const industrial = result.groups.find(group => group.industry === '工业')
  assert.equal(industrial.afterCount, 0); assert.equal(industrial.change, -1)
  assert.equal(result.groups.reduce((sum, group) => sum + group.beforeCount, 0), 3)
  assert.equal(result.groups.reduce((sum, group) => sum + group.afterCount, 0), 4)
  assert.equal(result.renamed.length, 1); assert.equal(result.industryChanges.length, 0)
  assert.equal(before.members[2].industry, null)
})

test('跨多次观察净变化可为零，逐次调入调出仍保留；空分类占比不冒充零', () => {
  const original = fixture().snapshots[0], middle = structuredClone(original), last = structuredClone(original)
  middle.observedAt = '2026-09-25T10:00:00Z'; middle.members[0].code = '000099'
  last.observedAt = '2026-09-26T10:00:00Z'
  const net = compareConstituentObservations(original, last)
  assert.equal(net.added.length, 0); assert.equal(net.removed.length, 0); assert.equal(net.retainedCount, 50)
  assert.equal(membershipTimeline({ snapshots: [original, middle, last] }).length, 2)
  const empty = compareConstituentObservations({ ...original, members: [] }, original)
  assert.ok(empty.groups.every(group => group.beforeShare === null && group.shareChange === null))
})

test('行业数量占比使用全部样本分母，未分类与保留分类明确计数；历史不被当前分类回填', () => {
  const data = fixture(), snapshot = data.snapshots[0]
  snapshot.members[0].industryStatus = 'stale'
  const distribution = industryDistribution(snapshot)
  assert.equal(distribution.total, 50); assert.equal(distribution.classified, 30)
  assert.equal(distribution.unknown, 20); assert.equal(distribution.stale, 1); assert.equal(distribution.industryCount, 1)
  assert.equal(distribution.groups[0].share, .6); assert.equal(distribution.groups[1].share, .4)
  assert.equal(distribution.groups.reduce((sum, group) => sum + group.count, 0), 50)
  const historical = structuredClone(snapshot)
  historical.members.forEach(member => { member.industry = null })
  assert.equal(industryDistribution(historical).classified, 0)
  assert.equal(industryDistribution(null).total, 0)
})

test('按市场和代码识别调入调出，改名不算调样，首条观察仅为基线', () => {
  const data = fixture(), before = data.snapshots[0], after = structuredClone(before)
  after.date = '2026-09-28'; after.observedAt = '2026-09-28T10:00:00Z'
  after.members[0].name = '新名称'
  after.members[1].code = '000099'; after.members[1].name = '新加入'
  const event = compareMembership(before, after)
  assert.equal(event.fromObservedAt, before.observedAt)
  assert.deepEqual(event.added.map(m => m.code), ['000099'])
  assert.deepEqual(event.removed.map(m => m.code), ['000002'])
  assert.deepEqual(event.renamed, [{ code: '000001', before: '股票1', after: '新名称' }])
  assert.equal(membershipTimeline(data).length, 0)
  data.snapshots.push(after)
  assert.equal(membershipTimeline(data).length, 1)
  after.members[2].exchange = 'SSE'
  assert.equal(compareMembership(before, after).added.length, 2)
})

test('数量集中度排除未分类，使用全部名单分母，并列行业和不足三个行业明确保留', () => {
  const snapshot = fixture().snapshots[0]
  snapshot.members.forEach((member, i) => { member.industry = i < 10 ? '金融' : i < 20 ? '工业' : i < 25 ? '能源' : null })
  const stats = industryDistribution(snapshot)
  assert.equal(stats.groups[0].label, '未分类')
  assert.equal(stats.concentration.largest.count, 10)
  assert.equal(stats.concentration.largest.share, .2)
  assert.deepEqual(new Set(stats.concentration.largest.industries), new Set(['金融', '工业']))
  assert.equal(stats.concentration.topThree.count, 25)
  assert.equal(stats.concentration.topThree.share, .5)
  snapshot.members.forEach((member, i) => { member.industry = i < 10 ? '金融' : null })
  assert.deepEqual(industryDistribution(snapshot).concentration.topThree, { count: 10, share: .2, industries: ['金融'] })
  snapshot.members.forEach(member => { member.industry = null })
  assert.equal(industryDistribution(snapshot).concentration, null)
  assert.equal(industryDistribution(null).concentration, null)
})

test('日期更新与首次补充分类不伪造调入，同行业名称变更和同源日期修订独立记录', () => {
  const data = fixture(), before = data.snapshots[0], after = structuredClone(before)
  after.observedAt = '2026-09-25T10:00:00Z'
  after.members[40].industry = '工业'
  data.snapshots.push(after)
  assert.deepEqual(membershipTimeline(data), [])
  after.members[0].industry = '工业'
  const event = membershipTimeline(data)[0]
  assert.equal(event.sameSourceDate, true)
  assert.equal(event.added.length, 0); assert.equal(event.removed.length, 0)
  assert.deepEqual(event.industryChanges, [{ code: '000001', name: '股票1', before: '金融', after: '工业' }])
})

test('当前行业只能匹配相同日期、身份及名称的名单，排序变化仍可匹配', () => {
  const data = fixture(), current = structuredClone(data.snapshots[0])
  current.members.reverse()
  assert.equal(matchingSnapshot(current, data), data.snapshots[0])
  current.date = '2026-09-25'; assert.equal(matchingSnapshot(current, data), null)
  current.date = '2026-09-24'; current.members[0].name = '修订'; assert.equal(matchingSnapshot(current, data), null)
})

test('历史读取校验身份、时间顺序、来源行业日期、重复证券及分类依据，损坏时拒绝', async () => {
  const original = fixture()
  assert.equal(validateConstituentHistory(original), original)
  const precise = fixture()
  precise.snapshots[0].observedAt = '2026-09-24T10:00:00.100001Z'
  precise.snapshots.push({ ...structuredClone(precise.snapshots[0]), observedAt: '2026-09-24T10:00:00.100002Z' })
  precise.lastAttemptAt = '2026-09-24T10:00:00.100003Z'
  assert.equal(validateConstituentHistory(precise), precise)
  for (const mutate of [d => { d.code = '512890' }, d => { d.industryBasis = 'guess' }, d => { d.snapshots[0].members[0].industrySourceIndex = '932079' },
    d => { d.snapshots[0].members[0].industryDate = '2026-02-30' }, d => { d.snapshots[0].members[0].industryObservedAt = '2026-09-25T10:00:00Z' },
    d => { d.snapshots[0].members[1].code = '000001' }, d => { d.snapshots.push(structuredClone(d.snapshots[0])) }, d => { d.lastAttemptAt = '2026-09-23T10:00:00Z' },
    d => { d.snapshots[0].date = '2999-01-01' }, d => { d.snapshots[0].members[40].industryObservedAt = '2026-09-24T10:00:00Z' }]) {
    const bad = structuredClone(original); mutate(bad)
    assert.throws(() => validateConstituentHistory(bad))
  }
  await assert.rejects(getConstituentHistory({ fetcher: async () => new Response('', { status: 503 }) }), /历史与行业分类读取失败/)
})

test('实际归档保留真实旧名单和未分类，最新行业来自独立日期且数量合计为50', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/constituents-history-h30269.json', import.meta.url), 'utf8'))
  const result = await getConstituentHistory({ fetcher: async () => Response.json(data) })
  assert.ok(result.snapshots.length >= 5)
  assert.equal(result.snapshots[0].date, '2026-09-24')
  assert.equal(industryDistribution(result.snapshots[0]).classified, 0)
  const last = industryDistribution(result.snapshots.at(-1))
  assert.ok(last.classified > 0); assert.equal(last.total, 50)
  assert.equal(last.classified + last.unknown, 50)
})
