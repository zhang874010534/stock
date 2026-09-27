import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionNotice, dataFreshness, validateSourceStatus } from '../src/utils/sourceStatus.js'
import { getSourceStatus } from '../src/api/sourceStatus.js'

const success = { status: 'ok', lastAttemptAt: '2026-09-24T10:15:00Z', lastSuccessAt: '2026-09-24T10:15:00Z', error: null }
test('collection failures remain failures even with readable data; missing status never implies success', () => {
  assert.match(collectionNotice({ ...success, status: 'error', error: '请求失败' }).text, /后台更新失败，显示已保存数据/)
  assert.match(collectionNotice({ ...success, status: 'error', error: '请求失败' }, { unavailable: true }).text, /未能重新核验/)
  assert.match(collectionNotice(success, { unavailable: true }).text, /未知/)
  assert.match(collectionNotice().text, /未知/)
  assert.equal(collectionNotice(success).warning, false)
  assert.match(collectionNotice(success).text, /采集成功/)
})

test('freshness respects weekends, holidays, publication grace and calendar coverage', () => {
  const freshness = (day, now, kind) => dataFreshness(day, { now: new Date(now), kind })
  assert.equal(freshness('2026-09-24', '2026-09-27T12:00:00Z', 'market').lag, 0)
  assert.equal(freshness('2026-09-23', '2026-09-27T12:00:00Z', 'indicator').level, 'current')
  assert.equal(freshness('2026-09-22', '2026-09-24T09:29:00Z', 'market').level, 'current')
  assert.equal(freshness('2026-09-22', '2026-09-24T09:30:00Z', 'market').level, 'old')
  assert.equal(freshness('2026-09-22', '2026-09-24T11:14:00Z', 'indicator').level, 'current')
  assert.equal(freshness('2026-09-22', '2026-09-24T11:15:00Z', 'indicator').level, 'old')
  assert.equal(freshness('2026-09-30', '2026-10-07T14:00:00Z', 'market').lag, 0)
  assert.equal(freshness('2026-12-31', '2027-01-04T14:00:00Z', 'market').level, 'unknown')
  assert.equal(freshness('2026-02-30', '2026-09-27T12:00:00Z', 'market').level, 'unknown')
  assert.equal(freshness('2026-09-28', '2026-09-27T12:00:00Z', 'market').level, 'unknown')
  assert.match(freshness('2026-09-17', '2026-09-27T12:00:00Z', 'market').text, /数据较旧/)
  // An old data date does not turn a successful collector into a failed one.
  assert.match(collectionNotice(success).text, /成功/)
})

test('status API validates independent records and rejects unreadable or malformed files', async () => {
  const payload = { schemaVersion: 1, sources: { H30269: success, bond: { status: 'error', lastAttemptAt: null, lastSuccessAt: null, error: '旧失败记录' } } }
  assert.deepEqual(await getSourceStatus({ fetcher: async () => Response.json(payload) }), payload)
  assert.throws(() => validateSourceStatus({ ...payload, sources: [] }))
  assert.throws(() => validateSourceStatus({ ...payload, sources: { unexpected: success } }))
  assert.throws(() => validateSourceStatus({ ...payload, sources: { bond: { ...success, lastSuccessAt: null } } }))
  assert.throws(() => validateSourceStatus({ ...payload, sources: { bond: { ...success, status: 'error', error: '' } } }))
  await assert.rejects(getSourceStatus({ fetcher: async () => new Response('', { status: 404 }) }))
  await assert.rejects(getSourceStatus({ fetcher: async () => Response.json({ schemaVersion: 2 }) }))
})
