import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorker } from '../worker/index.js'

const env = { AKSHARE_API_URL: 'https://example.invalid', AKSHARE_API_TOKEN: 'test-token' }
const payload = { status: 'ok', provider: 'AKShare', code: 'H30269', range: '1y', history: [{ date: '2026-09-03', close: 100 }] }
const request = (query = '') => new Request(`https://stock.example/api/history${query}`)

test('代理使用规范参数和服务密钥，不转发浏览器凭证，不延长缓存', async () => {
  let calls = 0
  const worker = createWorker({ fetcher: async (url, options) => {
    calls++
    assert.equal(url.href, 'https://example.invalid/api/history?symbol=H30269&range=1y')
    assert.deepEqual(options.headers, { Accept: 'application/json', Authorization: 'Bearer test-token' })
    assert.equal(options.redirect, 'manual')
    return Response.json(payload, { headers: { 'Cache-Control': 'public, max-age=17' } })
  } })
  const response = await worker.fetch(new Request('https://stock.example/api/history?symbol=h30269&range=1y&force=1&t=123', {
    headers: { Cookie: 'private-cookie', Authorization: 'Bearer browser-token' },
  }), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), payload)
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=17')
  assert.equal(calls, 1)
})

test('缺少配置、非HTTPS后端、循环代理和无效查询均不发出网络请求', async () => {
  const worker = createWorker({ fetcher: () => assert.fail('unexpected fetch') })
  assert.equal((await worker.fetch(request(), {})).status, 503)
  for (const backend of ['bad-url', 'http://example.invalid', 'https://name:pass@example.invalid', 'https://stock.example']) {
    assert.equal((await worker.fetch(request(), { AKSHARE_API_URL: backend })).status, 503)
  }
  for (const query of ['?symbol=000001', '?range=invalid']) {
    assert.equal((await worker.fetch(request(query), env)).status, 400)
  }
})

test('兼容旧入口且允许本机Python服务', async () => {
  const worker = createWorker({ fetcher: async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:8000/api/history?symbol=H30269&range=1y')
    assert.equal(options.headers.Authorization, undefined)
    return Response.json(payload)
  } })
  const response = await worker.fetch(new Request('https://stock.example/api/h30269?symbol=ignored'), { AKSHARE_API_URL: 'http://127.0.0.1:8000' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0')
})

test('失败不缓存并保留退避时间，服务密钥错误不暴露给浏览器', async () => {
  const worker = createWorker({ fetcher: async () => Response.json({ code: 'upstream_429', message: '请求受限' }, {
    status: 503, headers: { 'Retry-After': '120' },
  }) })
  const response = await worker.fetch(request(), env)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Retry-After'), '120')
  const unauthorized = createWorker({ fetcher: async () => Response.json({ message: 'private detail' }, { status: 401 }) })
  const failed = await unauthorized.fetch(request(), env)
  assert.equal(failed.status, 503)
  assert.equal((await failed.json()).code, 'backend_auth_failed')
})

test('HTML、错误格式、错误证券和非AKShare结果不当作行情显示', async () => {
  for (const data of [null, {}, { ...payload, provider: 'other' }, { ...payload, code: '000001' }, { ...payload, history: null }]) {
    const worker = createWorker({ fetcher: async () => Response.json(data) })
    assert.equal((await worker.fetch(request(), env)).status, 503)
  }
  const html = createWorker({ fetcher: async () => new Response('<html>Starting…</html>', { headers: { 'Content-Type': 'text/html' } }) })
  assert.equal((await html.fetch(request(), env)).status, 503)
})

test('代理超时会取消请求', async () => {
  let aborted = false
  const worker = createWorker({ timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
  }) })
  assert.equal((await worker.fetch(request(), env)).status, 503)
  assert.equal(aborted, true)
})

test('保留静态页面路由并限制API方法', async () => {
  const worker = createWorker({ fetcher: () => assert.fail('unexpected fetch') })
  assert.equal((await worker.fetch(new Request('https://stock.example/api/history', { method: 'POST' }), env)).status, 405)
  assert.equal((await worker.fetch(new Request('https://stock.example/api/unknown'), env)).status, 404)
  const response = await worker.fetch(new Request('https://stock.example/'), { ASSETS: { fetch: async () => new Response('site') } })
  assert.equal(await response.text(), 'site')
})
