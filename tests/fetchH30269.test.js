import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  H30269,
  MarketDataError,
  fetchEastmoneyRange,
  isValidKline,
  mergeHistory,
  parseEastmoneyKline,
} from '../scripts/lib/market-data.mjs'
import {
  createDataset,
  updateH30269,
  validateDataset,
} from '../scripts/fetch-h30269.mjs'

const NOW = new Date('2026-09-04T08:30:00.000Z')
const point = (date, close, extra = {}) => ({
  date,
  open: close - 1,
  close,
  high: close + 2,
  low: close - 2,
  volume: close * 100,
  amount: close * 1000,
  ...extra,
})
const line = (value) => [value.date, value.open, value.close, value.high, value.low, value.volume ?? '-', value.amount ?? '-'].join(',')
const response = (history, init) => Response.json({
  rc: 0,
  data: history === null ? null : { code: H30269.code, market: 2, klines: history.map(line) },
}, init)
const silentLogger = { log() {}, warn() {} }

function validDataset(history, backfill = {}) {
  const earliest = new Date(`${history[0].date}T00:00:00Z`)
  earliest.setUTCDate(earliest.getUTCDate() - 1)
  return createDataset(history, {
    earliestDate: history[0].date,
    completed: backfill.completed ?? false,
    nextEndDate: backfill.nextEndDate ?? earliest.toISOString().slice(0, 10),
    consecutiveEmptyRanges: backfill.consecutiveEmptyRanges ?? 0,
  }, '2026-09-03T08:30:00.000Z')
}

async function withDatasetFile(data, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'h30269-test-'))
  const filePath = join(directory, 'h30269.json')
  if (data) await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`)
  try {
    return await callback(filePath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('OHLC 数据校验包含价格关系，volume 和 amount 可选', () => {
  assert.equal(isValidKline(point('2026-09-04', 100)), true)
  assert.equal(isValidKline(point('2026-09-04', 100, { high: 99 })), false)
  assert.equal(isValidKline(point('2026-09-04', 100, { low: 101 })), false)
  assert.equal(isValidKline(point('2026-09-04', 100, { open: 0 })), false)
  assert.deepEqual(parseEastmoneyKline('2026-09-04,99,100,102,98,-,-'), {
    date: '2026-09-04', open: 99, close: 100, high: 102, low: 98,
  })
  assert.throws(() => parseEastmoneyKline('2026-09-04,99,100,98,97,1,2'), MarketDataError)
})

test('merge 按日期排序，同日期新数据覆盖旧数据', () => {
  const merged = mergeHistory(
    [point('2026-09-03', 100), point('2026-09-01', 98)],
    [point('2026-09-02', 99), point('2026-09-03', 101)],
  )
  assert.deepEqual(merged.map(({ date }) => date), ['2026-09-01', '2026-09-02', '2026-09-03'])
  assert.equal(merged.at(-1).close, 101)
})

test('近期数据和历史回补都能合并，不丢失旧历史', () => {
  const old = [point('2026-06-01', 80), point('2026-08-30', 90)]
  const recentMerged = mergeHistory(old, [point('2026-08-30', 91), point('2026-09-04', 100)])
  assert.deepEqual(recentMerged.map(({ date }) => date), ['2026-06-01', '2026-08-30', '2026-09-04'])
  assert.equal(recentMerged[1].close, 91)
  const backfilled = mergeHistory(recentMerged, [point('2026-03-01', 70)])
  assert.deepEqual(backfilled.map(({ date }) => date), ['2026-03-01', '2026-06-01', '2026-08-30', '2026-09-04'])
})

test('latest 始终自动等于 history 最后一条', () => {
  const history = [point('2026-09-03', 99), point('2026-09-04', 100)]
  const data = validDataset(history)
  assert.deepEqual(data.latest, history.at(-1))
  assert.equal(validateDataset(data), true)
  assert.throws(() => validateDataset({ ...data, latest: history[0] }), /latest/)
})

test('近期空数据不会覆盖旧文件', async () => {
  const old = validDataset([point('2026-09-03', 99)], { completed: true })
  await withDatasetFile(old, async (filePath) => {
    let writes = 0
    const before = await readFile(filePath, 'utf8')
    const result = await updateH30269({
      filePath, now: NOW, fetcher: async () => response([]), logger: silentLogger,
      writer: async () => { writes++ }, requestDelayMs: 0,
    })
    assert.equal(result.changed, false)
    assert.equal(writes, 0)
    assert.equal(await readFile(filePath, 'utf8'), before)
  })
})

test('行情和回补状态无变化时不重写文件', async () => {
  const latest = point('2026-09-04', 100)
  const old = validDataset([latest], { completed: true })
  await withDatasetFile(old, async (filePath) => {
    let writes = 0
    const result = await updateH30269({
      filePath, now: NOW, fetcher: async () => response([latest]), logger: silentLogger,
      writer: async () => { writes++ }, requestDelayMs: 0,
    })
    assert.equal(result.changed, false)
    assert.equal(writes, 0)
  })
})

test('历史回补失败不推进 earliestDate 或回补游标', async () => {
  const latest = point('2026-09-04', 100)
  const old = validDataset([latest])
  await withDatasetFile(old, async (filePath) => {
    const replies = [response([latest]), new Response('unavailable', { status: 503 })]
    const result = await updateH30269({
      filePath, now: NOW, fetcher: async () => replies.shift(), logger: silentLogger,
      requestDelayMs: 0,
    })
    assert.equal(result.changed, false)
    assert.equal(result.data.backfill.earliestDate, old.backfill.earliestDate)
    assert.equal(result.data.backfill.nextEndDate, old.backfill.nextEndDate)
    assert.equal(result.errors[0].task, 'backfill')
  })
})

test('近期行情成功而历史回补失败时，仍保存近期更新', async () => {
  const oldLatest = point('2026-09-03', 99)
  const newLatest = point('2026-09-04', 100)
  const old = validDataset([oldLatest])
  await withDatasetFile(old, async (filePath) => {
    const replies = [response([newLatest]), new Response('unavailable', { status: 503 })]
    const result = await updateH30269({
      filePath, now: NOW, fetcher: async () => replies.shift(), logger: silentLogger,
      requestDelayMs: 0,
    })
    assert.equal(result.changed, true)
    assert.equal(result.errors[0].task, 'backfill')
    assert.deepEqual(result.data.latest, newLatest)
    assert.equal(result.data.backfill.earliestDate, old.backfill.earliestDate)
    assert.equal(result.data.backfill.nextEndDate, old.backfill.nextEndDate)
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), result.data)
  })
})

test('近期更新失败而回补成功时，latest 仍是全量历史最后一条', async () => {
  const latest = point('2026-09-03', 100)
  const old = validDataset([latest])
  await withDatasetFile(old, async (filePath) => {
    const older = point('2026-07-01', 80)
    const replies = [new Response('{bad json'), response([older])]
    const result = await updateH30269({
      filePath, now: NOW, fetcher: async () => replies.shift(), logger: silentLogger,
      requestDelayMs: 0,
    })
    assert.equal(result.changed, true)
    assert.deepEqual(result.data.latest, latest)
    assert.equal(result.data.history[0].date, older.date)
  })
})

test('403、429、503 都作为可识别的上游错误处理', async () => {
  for (const status of [403, 429, 503]) {
    await assert.rejects(
      fetchEastmoneyRange(H30269, { start: '2026-09-01', end: '2026-09-04' }, {
        fetcher: async () => new Response('error', { status, headers: status === 429 ? { 'Retry-After': '120' } : {} }),
        now: NOW,
      }),
      (error) => error instanceof MarketDataError && error.upstreamStatus === status && (status !== 429 || error.retryAfterSeconds === 120),
    )
  }
})

test('回补空窗口逐段向前，连续三段才完成', async () => {
  let current = validDataset([point('2026-09-04', 100)])
  for (let attempt = 1; attempt <= 3; attempt++) {
    await withDatasetFile(current, async (filePath) => {
      const replies = [response([point('2026-09-04', 100)]), response(null)]
      const result = await updateH30269({
        filePath, now: NOW, fetcher: async () => replies.shift(), logger: silentLogger,
        requestDelayMs: 0,
      })
      current = result.data
      assert.equal(current.backfill.consecutiveEmptyRanges, attempt)
      assert.equal(current.backfill.completed, attempt === 3)
    })
  }
})
