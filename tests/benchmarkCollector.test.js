import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { refreshBenchmark } from '../scripts/fetch-benchmark.mjs'
import { CSI300, createEastmoneyUrl } from '../scripts/lib/market-data.mjs'
import { validateMarketData } from '../src/utils/kline.js'
import { getMarketData } from '../src/api/h30269.js'

const now = new Date('2026-09-30T10:00:00Z')
const logger = { log() {}, warn() {}, error() {} }
const payload = (code = '000300', klines = ['2026-01-05,100,100,100,100,10,1000', '2026-01-06,101,101,101,101,10,1000']) =>
  Response.json({ rc: 0, data: { code, market: 1, klines } })
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'stock-benchmark-test-'))
  try { await run(directory) }
  finally { assert.ok(directory.startsWith(join(tmpdir(), 'stock-benchmark-test-'))); await rm(directory, { recursive: true, force: true }) }
}

test('沪深300身份、接口与独立文件可验证，初始化保留其他来源状态，失败保留旧行情和成功时间', async () => fixture(async directory => {
  const source = { status: 'error', lastAttemptAt: '2026-09-29T10:00:00Z', lastSuccessAt: null, error: '原行情失败' }
  await writeFile(join(directory, 'dashboard-source-status.json'), JSON.stringify({ schemaVersion: 1, sources: { H30269: source } }))
  let url
  const options = { directory, now, bootstrap: true, start: '2026-01-01', end: '2026-01-06', logger, retryDelaysMs: [] }
  const first = await refreshBenchmark({ ...options, fetcher: async value => { url = value; return payload() } })
  assert.equal(new URL(url).searchParams.get('secid'), '1.000300')
  assert.equal(new URL(url).searchParams.get('fqt'), '0')
  validateMarketData(first.data, '000300')
  const snapshot = await readFile(join(directory, '000300.json'), 'utf8')
  const readStatus = async () => JSON.parse(await readFile(join(directory, 'dashboard-source-status.json'), 'utf8'))
  assert.deepEqual((await readStatus()).sources.H30269, source)
  assert.equal((await readStatus()).sources['000300'].status, 'ok')
  const loaded = await getMarketData('000300', { fetcher: async value => { assert.match(value, /\/data\/000300.json/); return Response.json(first.data) } })
  assert.equal(loaded.code, '000300')
  await assert.rejects(refreshBenchmark({ ...options, now: new Date('2026-10-01T10:00:00Z'), fetcher: async () => payload('510300') }), /行情格式异常/)
  assert.equal(await readFile(join(directory, '000300.json'), 'utf8'), snapshot)
  const failed = await readStatus()
  assert.equal(failed.sources['000300'].status, 'error')
  assert.equal(failed.sources['000300'].lastSuccessAt, now.toISOString())
  assert.deepEqual(failed.sources.H30269, source)
}))

test('空返回和未来初始化区间不能生成伪造快照，拒绝指数与ETF身份混用', async () => fixture(async directory => {
  const options = { directory, now, bootstrap: true, start: '2026-01-01', end: '2026-01-06', logger, retryDelaysMs: [] }
  await assert.rejects(refreshBenchmark({ ...options, fetcher: async () => payload('000300', []) }), /未返回有效行情/)
  await assert.rejects(readFile(join(directory, '000300.json')), { code: 'ENOENT' })
  await assert.rejects(refreshBenchmark({ ...options, end: '2027-01-01' }), /日期区间无效/)
  assert.equal(new URL(createEastmoneyUrl(CSI300, '2026-01-01', '2026-01-06')).searchParams.get('secid'), '1.000300')
}))
