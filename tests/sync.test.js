import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import worker from '../worker/index.js'
import { syncIndex, localDay } from '../worker/sync.js'
import { INDEX_CODE, ensureSchema, readCoverage, readIndex } from '../worker/database.js'

// Real SQLite transactions, adapting only D1's asynchronous API shape.
function database(t) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  let batchQueue = Promise.resolve()
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      let values = []
      return {
        bind(...args) { values = args; return this },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) }, success: true } },
        async all() { return { results: statement.all(...values).map((row) => ({ ...row })) } },
        async first() { const row = statement.get(...values); return row ? { ...row } : null },
      }
    },
    batch(statements) {
      const pending = batchQueue.then(async () => {
        sqlite.exec('BEGIN')
        try {
          const results = []
          for (const statement of statements) results.push(await statement.run())
          sqlite.exec('COMMIT')
          return results
        } catch (error) { sqlite.exec('ROLLBACK'); throw error }
      })
      batchQueue = pending.catch(() => {})
      return pending
    },
  }
}

function sourceRow(date, close = 100) {
  return { indexCode: INDEX_CODE, tradeDate: date.replaceAll('-', ''), close }
}

function harness(t, floor = '2026-01-01') {
  const env = { DB: database(t), HISTORY_START_DATE: floor }
  const calls = []
  const sleeps = []
  let clock = new Date('2026-09-02T10:00:00Z')
  let responder = (url) => Response.json({ code: '200', data: [{ indexCode: INDEX_CODE, tradeDate: url.searchParams.get('endDate'), close: 100 }] })
  const deps = {
    now: () => clock,
    sleep: async (ms) => sleeps.push(ms),
    fetch: async (url, options) => { calls.push({ url: new URL(url), options }); return responder(new URL(url)) },
  }
  return {
    env, calls, sleeps, deps,
    run: () => syncIndex(env, deps),
    day: (date) => { clock = new Date(`${date}T10:00:00Z`) },
    respond: (fn) => { responder = fn },
    range: (index) => [calls[index].url.searchParams.get('startDate'), calls[index].url.searchParams.get('endDate')],
  }
}

test('首次近30天，后续近7天加一个月历史，两次间隔30秒', async (t) => {
  const h = harness(t)
  assert.deepEqual(await h.run(), { status: 'ok', requests: 1, rows: 1 })
  assert.deepEqual(h.range(0), ['20260804', '20260902'])
  assert.equal(h.calls[0].options.redirect, 'manual')
  h.day('2026-09-03')
  assert.equal((await h.run()).requests, 2)
  assert.deepEqual(h.range(1), ['20260828', '20260903'])
  assert.deepEqual(h.range(2), ['20260704', '20260803'])
  assert.deepEqual(h.sleeps, [30000])
  assert.deepEqual(await readCoverage(h.env.DB), [{ start: '2026-07-04', end: '2026-09-03' }])
})

test('重复和并发触发不会追加上游请求', async (t) => {
  const h = harness(t)
  await ensureSchema(h.env.DB)
  const results = await Promise.all([h.run(), h.run()])
  assert.equal(results.filter((result) => result.status === 'ok').length, 1)
  assert.equal(h.calls.length, 1)
  assert.equal((await h.run()).status, 'already_ran')
  assert.equal(h.calls.length, 1)
})

test('长时间中断后先更新行情，后补中间缺口', async (t) => {
  const h = harness(t)
  await h.run()
  h.day('2026-10-10')
  await h.run()
  assert.deepEqual(h.range(1), ['20261004', '20261010'])
  assert.deepEqual(h.range(2), ['20260904', '20261003'])
  h.day('2026-10-11')
  await h.run()
  assert.deepEqual(h.range(4), ['20260903', '20260903'])
  assert.deepEqual(await readCoverage(h.env.DB), [{ start: '2026-08-04', end: '2026-10-11' }])
})

test('补到目标日期后只保留每日一次更新', async (t) => {
  const h = harness(t, '2026-08-01')
  await h.run()
  h.day('2026-09-03')
  await h.run()
  assert.deepEqual(h.range(2), ['20260801', '20260803'])
  assert.equal((await readIndex(h.env.DB, h.env.HISTORY_START_DATE)).sync.historyComplete, true)
  h.day('2026-09-04')
  assert.equal((await h.run()).requests, 1)
})

test('重叠日期更新原记录，多条数据分批写入', async (t) => {
  const h = harness(t)
  h.respond(() => Response.json({ code: 200, data: Array.from({ length: 28 }, (_, index) => sourceRow(`2026-08-${String(index + 4).padStart(2, '0')}`, 100 + index)) }))
  await h.run()
  h.day('2026-09-03')
  h.respond((url) => Response.json({ code: 200, data: [sourceRow(url.searchParams.get('endDate') === '20260903' ? '2026-08-31' : '2026-08-03', 999)] }))
  await h.run()
  const result = await readIndex(h.env.DB)
  assert.equal(result.history.length, 29)
  assert.equal(result.history.find((row) => row.date === '2026-08-31').close, 999)
})

test('请求失败当天不重试、不回补，次日从原进度继续', async (t) => {
  const h = harness(t)
  await h.run()
  const before = await readCoverage(h.env.DB)
  h.day('2026-09-03')
  h.respond(() => new Response('unavailable', { status: 503 }))
  await assert.rejects(h.run(), /503/)
  assert.deepEqual(await readCoverage(h.env.DB), before)
  assert.equal((await h.run()).status, 'already_ran')
  assert.equal(h.calls.length, 2)
  h.day('2026-09-04')
  h.respond((url) => Response.json({ code: 200, data: [{ indexCode: INDEX_CODE, tradeDate: url.searchParams.get('endDate'), close: 100 }] }))
  await h.run()
  assert.deepEqual(h.range(3), ['20260704', '20260803'])
})

test('429遵守Retry-After，等待期间不请求', async (t) => {
  const h = harness(t)
  h.respond(() => new Response('', { status: 429, headers: { 'Retry-After': '172800' } }))
  await assert.rejects(h.run(), /429/)
  h.day('2026-09-03')
  assert.equal((await h.run()).status, 'cooldown')
  assert.equal(h.calls.length, 1)
  assert.equal((await readIndex(h.env.DB)).sync.retryAfter, '2026-09-04T10:00:00.000Z')
})

test('403暂停后续抓取，停用开关不发请求', async (t) => {
  const h = harness(t)
  h.respond(() => new Response('', { status: 403 }))
  await assert.rejects(h.run(), /403/)
  h.day('2026-09-03')
  assert.equal((await h.run()).status, 'paused')
  h.env.SYNC_ENABLED = 'false'
  assert.equal((await h.run()).status, 'disabled')
  assert.equal(h.calls.length, 1)
})

test('无效点位、日期、其他指数混入时整批拒绝', async (t) => {
  for (const row of [sourceRow('2026-08-31', 0), sourceRow('2026-02-30'), { ...sourceRow('2026-08-31'), indexCode: '000300' }]) {
    const h = harness(t)
    h.respond(() => Response.json({ code: 200, data: [sourceRow('2026-08-30'), row] }))
    await assert.rejects(h.run(), /无效记录/)
    assert.equal((await readIndex(h.env.DB)).history.length, 0)
    assert.deepEqual(await readCoverage(h.env.DB), [])
  }
})

test('写入中断时行情和进度一起回滚，已有数据保留', async (t) => {
  const h = harness(t)
  await h.run()
  const before = await readCoverage(h.env.DB)
  h.env.DB.sqlite.exec(`CREATE TRIGGER reject_update BEFORE UPDATE ON index_daily BEGIN SELECT RAISE(ABORT, 'test failure'); END`)
  h.day('2026-09-03')
  h.respond(() => Response.json({ code: 200, data: [sourceRow('2026-09-03', 102), sourceRow('2026-09-02', 101)] }))
  await assert.rejects(h.run(), /test failure/)
  assert.deepEqual(await readCoverage(h.env.DB), before)
  assert.deepEqual((await readIndex(h.env.DB)).history, [{ date: '2026-09-02', close: 100 }])
})

test('整个历史月为空不推进进度', async (t) => {
  const h = harness(t)
  await h.run()
  h.day('2026-09-03')
  h.respond((url) => Response.json({ code: 200, data: url.searchParams.get('endDate') === '20260903' ? [sourceRow('2026-09-03')] : [] }))
  await assert.rejects(h.run(), /未返回/)
  assert.equal((await readCoverage(h.env.DB))[0].start, '2026-08-04')
})

test('API读取D1，不额外抓取；空库和方法限制有正确响应', async (t) => {
  const h = harness(t)
  const request = new Request('https://stock.example/api/h30269')
  assert.equal((await (await worker.fetch(request, h.env)).json()).status, 'empty')
  await h.run()
  const calls = h.calls.length
  const response = await worker.fetch(request, h.env)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).latest, { date: '2026-09-02', close: 100 })
  assert.equal(h.calls.length, calls)
  assert.equal((await worker.fetch(new Request(request.url, { method: 'POST' }), h.env)).status, 405)
  assert.equal((await worker.fetch(request, {})).status, 503)
  assert.equal((await worker.fetch(new Request('https://stock.example/api/sync'), h.env)).status, 404)
})

test('日额度按北京时间划分', () => {
  assert.equal(localDay(new Date('2026-09-02T15:59:59Z')), '2026-09-02')
  assert.equal(localDay(new Date('2026-09-02T16:00:00Z')), '2026-09-03')
})
