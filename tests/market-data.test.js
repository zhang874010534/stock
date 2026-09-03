import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { INSTRUMENTS, dateBounds, fetchHistory } from '../worker/market-data.js'
import worker, { createWorker } from '../worker/index.js'

const instrument = INSTRUMENTS.get('H30269')
const instant = new Date('2026-09-03T10:00:00Z')
const lines = ['2026-09-02,99,100,102,98', '2026-09-03,100,101,103,99']
const payload = (klines = lines) => ({ rc: 0, data: { code: 'H30269', market: 2, klines } })

test('查询按上海日期限制范围，处理月末并仅在选择全部时查长期历史', () => {
  assert.deepEqual(dateBounds(instrument, '1m', new Date('2026-09-02T16:30:00Z')), { start: '2026-07-24', end: '2026-09-03' })
  assert.deepEqual(dateBounds(instrument, '1m', new Date('2024-03-31T10:00:00Z')), { start: '2024-02-19', end: '2024-03-31' })
  assert.deepEqual(dateBounds(instrument, '1y', instant), { start: '2025-08-24', end: '2026-09-03' })
  assert.deepEqual(dateBounds(instrument, 'all', instant), { start: '2005-12-30', end: '2026-09-03' })
})

test('请求正确的东方财富市场、日线与日期；取收盘字段、过滤区间、排序去重', async () => {
  const result = await fetchHistory(instrument, '1y', {
    now: instant,
    fetcher: async (url, options) => {
      assert.equal(url.hostname, 'push2his.eastmoney.com')
      assert.equal(url.searchParams.get('secid'), '2.H30269')
      assert.equal(url.searchParams.get('klt'), '101')
      assert.equal(url.searchParams.get('fqt'), '0')
      assert.equal(url.searchParams.get('beg'), '20250824')
      assert.equal(url.searchParams.get('end'), '20260903')
      assert.equal(options.redirect, 'manual')
      return Response.json(payload([lines[1], lines[0], '2026-09-03,100,102', '2026-09-04,100,103', '2024-01-01,100,99']))
    },
  })
  assert.deepEqual(result.history, [{ date: '2026-09-02', close: 100 }, { date: '2026-09-03', close: 102 }])
  assert.equal(result.source, '东方财富')
  assert.equal(result.interval, '1d')
  assert.equal(result.updatedAt, instant.toISOString())
  assert.deepEqual(result.latest, result.history.at(-1))
})

test('拒绝其他证券、错误市场、空数据和损坏的日线，不填入假数据', async () => {
  for (const body of [
    { rc: 0, data: null },
    { rc: 1, data: payload().data },
    { rc: 0, data: { ...payload().data, code: '000001' } },
    { rc: 0, data: { ...payload().data, market: 1 } },
    payload([]), payload(['2026-02-30,100,101']), payload(['2026-09-03,100,NaN']), payload(['2026-09-03,100,0']), payload([null]),
  ]) {
    await assert.rejects(fetchHistory(instrument, '1y', { now: instant, fetcher: async () => Response.json(body) }), /东方财富/)
  }
})

test('超时中止上游请求且不自动重试', async () => {
  let calls = 0
  await assert.rejects(fetchHistory(instrument, '1y', {
    now: instant, timeoutMs: 10,
    fetcher: async (_url, { signal }) => {
      calls++
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    },
  }), /超时/)
  assert.equal(calls, 1)
})

function harness(responder = () => Response.json(payload())) {
  const entries = new Map()
  const cache = {
    async match(key) { return entries.get(key.url)?.clone() },
    async put(key, response) { entries.set(key.url, response.clone()) },
  }
  let clock = instant.getTime()
  let calls = 0
  const dependencies = { getCache: () => cache, now: () => new Date(clock), fetcher: async (...args) => { calls++; return responder(...args) } }
  const app = createWorker(dependencies)
  return {
    app, dependencies, calls: () => calls, advance: (ms) => { clock += ms },
    request: (path = '/api/history?symbol=H30269&range=1y', target = app) => target.fetch(new Request(`https://stock.test${path}`), {}),
  }
}

test('同一区间的并发与重复请求共用结果，多余参数和旧入口不能绕过缓存', async () => {
  const h = harness()
  const responses = await Promise.all(Array.from({ length: 5 }, () => h.request()))
  assert.equal(h.calls(), 1)
  for (const response of responses) assert.equal((await response.json()).history.length, 2)
  h.advance(20_000)
  const cached = await h.request('/api/h30269?range=1y&force=true&t=123')
  assert.equal(cached.headers.get('Cache-Control'), 'public, max-age=40')
  assert.equal(h.calls(), 1)
  await h.request('/api/history?symbol=h30269&range=1y', createWorker(h.dependencies))
  assert.equal(h.calls(), 1)
  h.advance(41_000)
  await h.request()
  assert.equal(h.calls(), 2)
})

test('不同时间范围各自按需加载', async () => {
  const h = harness()
  await h.request()
  const monthly = await h.request('/api/history?symbol=H30269&range=1m')
  assert.equal((await monthly.json()).range, '1m')
  assert.equal(h.calls(), 2)
  await h.request('/api/history?symbol=H30269&range=1m')
  assert.equal(h.calls(), 2)
})

test('429冷却跨区间和实例生效，遵守Retry-After秒数与HTTP日期', async () => {
  for (const retryAfter of ['120', 'Thu, 03 Sep 2026 10:02:00 GMT']) {
    const h = harness(() => new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }))
    const response = await h.request()
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('Retry-After'), '120')
    h.advance(30_000)
    const blocked = await h.request('/api/history?range=5y', createWorker(h.dependencies))
    assert.equal(blocked.status, 503)
    assert.equal(blocked.headers.get('Retry-After'), '90')
    assert.equal(h.calls(), 1)
    h.advance(91_000)
    await h.request()
    assert.equal(h.calls(), 2)
  }
})

test('403冷却15分钟；普通故障短缓存避免反复刷新连续请求', async () => {
  for (const [status, seconds] of [[403, 900], [500, 60]]) {
    const h = harness(() => new Response('', { status }))
    const response = await h.request()
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Retry-After'), String(seconds))
    const body = await response.json()
    assert.equal(body.history, undefined)
    assert.equal(body.upstreamStatus, status)
    await h.request()
    assert.equal(h.calls(), 1)
  }
})

test('无效参数与方法不请求上游，静态资源仍由Assets提供', async () => {
  const h = harness()
  assert.equal((await h.request('/api/history?symbol=__proto__')).status, 400)
  assert.equal((await h.request('/api/history?range=10y')).status, 400)
  assert.equal((await h.request('/api/sync')).status, 404)
  const post = await h.app.fetch(new Request('https://stock.test/api/history', { method: 'POST' }), {})
  assert.equal(post.status, 405)
  assert.equal(h.calls(), 0)
  const asset = await h.app.fetch(new Request('https://stock.test/'), { ASSETS: { fetch: async () => new Response('app') } })
  assert.equal(await asset.text(), 'app')
})

test('Worker无需数据库且部署配置显式清除旧定时触发器', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
  assert.equal(config.d1_databases, undefined)
  assert.deepEqual(config.triggers.crons, [])
  assert.equal(worker.scheduled, undefined)
})
