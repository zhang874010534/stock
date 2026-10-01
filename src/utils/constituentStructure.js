import { CONSTITUENTS_SOURCE, validateConstituents } from '../api/constituents.js'

export const INDUSTRY_SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30199_Index_Methodology_cn.pdf'
export const INDUSTRY_BASIS = 'csi_level1_membership_match'
export const INDUSTRIES = { '932077': '能源', '932078': '原材料', '932079': '工业', '932080': '可选消费', '932081': '主要消费', '932082': '医药卫生', '932083': '金融', '931775': '房地产', '932084': '信息技术', '932085': '通信服务', '932086': '公用事业' }
const requireValue = (condition, message = '成分股历史数据格式异常') => { if (!condition) throw new Error(message) }
const keyOf = member => `${member.exchange}:${member.code}`
export function membershipSignature(snapshot) {
  return snapshot.members.map(member => `${keyOf(member)}:${member.name}`).sort().join('|')
}
function observationTime(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60_000)
  requireValue(new Date(Date.parse(value)).toISOString().slice(0, 19) === value.slice(0, 19))
  return Date.parse(value)
}
// Python observation timestamps retain microseconds; Date.parse alone truncates
// them and would reject two distinct same-millisecond observations.
const observationOrder = value => `${value.slice(0, 19)}.${(value.split('.')[1]?.slice(0, -1) ?? '').padEnd(6, '0')}Z`
export function validateConstituentHistory(data) {
  requireValue(data?.schemaVersion === 1 && data.code === 'H30269' && data.source === CONSTITUENTS_SOURCE && data.industrySource === INDUSTRY_SOURCE && data.industryBasis === INDUSTRY_BASIS && Array.isArray(data.snapshots))
  requireValue(['ok', 'stale', 'unavailable'].includes(data.membershipStatus) && ['ok', 'partial', 'unavailable'].includes(data.industryStatus))
  for (const [status, reason] of [[data.membershipStatus, data.membershipReason], [data.industryStatus, data.industryReason]]) {
    requireValue(status === 'ok' ? reason === null : typeof reason === 'string' && Boolean(reason.trim()))
  }
  if (data.lastAttemptAt !== null) observationTime(data.lastAttemptAt)
  let previousDate = '', previousOrder = ''
  for (const snapshot of data.snapshots) {
    validateConstituents({ schemaVersion: 1, code: 'H30269', source: CONSTITUENTS_SOURCE, status: 'ok', count: snapshot?.members?.length, date: snapshot?.date, members: snapshot?.members })
    const observed = observationTime(snapshot.observedAt)
    const order = observationOrder(snapshot.observedAt)
    requireValue(snapshot.date >= previousDate && order > previousOrder)
    requireValue(new Date(observed + 8 * 3600_000).toISOString().slice(0, 10) >= snapshot.date)
    for (const member of snapshot.members) {
      if (member.industry === null) requireValue(member.industryStatus === 'unavailable' && member.industryObservedAt === null && member.industryDate === null && member.industrySourceIndex === null)
      else {
        requireValue(INDUSTRIES[member.industrySourceIndex] === member.industry && ['ok', 'stale'].includes(member.industryStatus) && observationTime(member.industryObservedAt) <= observed && observationOrder(member.industryObservedAt) <= order)
        const day = Date.parse(`${member.industryDate}T00:00:00Z`)
        requireValue(typeof member.industryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(member.industryDate) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === member.industryDate && member.industryDate <= new Date(observed + 8 * 3600_000).toISOString().slice(0, 10))
      }
    }
    previousDate = snapshot.date; previousOrder = order
  }
  requireValue(data.snapshots.length ? data.membershipStatus !== 'unavailable' : data.membershipStatus === 'unavailable')
  if (data.lastAttemptAt !== null && data.snapshots.length) requireValue(observationOrder(data.lastAttemptAt) >= previousOrder)
  return data
}
export function matchingSnapshot(current, history) {
  if (!current?.members.length) return null
  return history?.snapshots.findLast(snapshot => snapshot.date === current.date && membershipSignature(snapshot) === membershipSignature(current)) ?? null
}
export function industryDistribution(snapshot) {
  const groups = new Map()
  let classified = 0, stale = 0
  for (const member of snapshot?.members ?? []) {
    const industry = member.industry ?? null
    if (industry !== null) { classified++; if (member.industryStatus === 'stale') stale++ }
    if (!groups.has(industry)) groups.set(industry, { industry, label: industry ?? '未分类', count: 0, members: [] })
    const group = groups.get(industry); group.count++; group.members.push(member)
  }
  const total = snapshot?.members.length ?? 0
  return { total, classified, stale, unknown: total - classified, industryCount: [...groups.keys()].filter(key => key !== null).length,
    groups: [...groups.values()].map(group => ({ ...group, share: total ? group.count / total : 0 })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN')) }
}
export function compareMembership(previous, current) {
  const before = new Map(previous.members.map(member => [keyOf(member), member]))
  const after = new Map(current.members.map(member => [keyOf(member), member]))
  const added = current.members.filter(member => !before.has(keyOf(member)))
  const removed = previous.members.filter(member => !after.has(keyOf(member)))
  const renamed = current.members.filter(member => before.has(keyOf(member)) && before.get(keyOf(member)).name !== member.name)
    .map(member => ({ code: member.code, before: before.get(keyOf(member)).name, after: member.name }))
  const industryChanges = current.members.filter(member => member.industry && before.get(keyOf(member))?.industry && before.get(keyOf(member)).industry !== member.industry)
    .map(member => ({ code: member.code, name: member.name, before: before.get(keyOf(member)).industry, after: member.industry }))
  return { fromDate: previous.date, date: current.date, observedAt: current.observedAt, sameSourceDate: previous.date === current.date, added, removed, renamed, industryChanges }
}
export function membershipTimeline(history) {
  return (history?.snapshots ?? []).slice(1).map((snapshot, index) => compareMembership(history.snapshots[index], snapshot))
    .filter(event => event.added.length || event.removed.length || event.renamed.length || event.industryChanges.length).reverse()
}
