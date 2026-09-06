import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { dirname, basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  H30269,
  MarketDataError,
  fetchEastmoneyRange,
  isValidDate,
  mergeHistory,
  shanghaiDate,
  shiftDate,
  validateHistory,
} from './lib/market-data.mjs'

export const RECENT_DAYS = 30
export const BACKFILL_DAYS = 90
export const EMPTY_RANGES_TO_COMPLETE = 3
export const REQUEST_DELAY_MS = 3_000
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]
export const MAX_RETRY_DELAY_MS = 60_000

function clone(value) {
  return structuredClone(value)
}

export function recentBounds(now = new Date()) {
  const end = shanghaiDate(now)
  return { start: shiftDate(end, -(RECENT_DAYS - 1)), end }
}

export function backfillBounds(backfill, history) {
  const earliestDate = history[0]?.date
  if (!earliestDate) throw new Error('Cannot backfill without existing history')
  const end = backfill.nextEndDate ?? shiftDate(earliestDate, -1)
  return { start: shiftDate(end, -(BACKFILL_DAYS - 1)), end }
}

function normalizeBackfill(backfill, history) {
  const earliestDate = history[0].date
  if (!backfill || backfill.earliestDate !== earliestDate || typeof backfill.completed !== 'boolean') throw new Error('Invalid backfill state')
  const normalized = {
    earliestDate,
    completed: backfill.completed,
    nextEndDate: backfill.nextEndDate ?? shiftDate(earliestDate, -1),
    consecutiveEmptyRanges: backfill.consecutiveEmptyRanges ?? 0,
  }
  if (!isValidDate(normalized.nextEndDate) || normalized.nextEndDate >= earliestDate) throw new Error('Invalid backfill cursor')
  if (!Number.isInteger(normalized.consecutiveEmptyRanges) || normalized.consecutiveEmptyRanges < 0 || normalized.consecutiveEmptyRanges > EMPTY_RANGES_TO_COMPLETE) {
    throw new Error('Invalid empty backfill range count')
  }
  return normalized
}

export function createDataset(history, backfill, updatedAt) {
  validateHistory(history)
  const normalizedBackfill = normalizeBackfill(backfill, history)
  return {
    code: H30269.code,
    name: H30269.name,
    source: 'eastmoney',
    interval: '1d',
    updatedAt,
    backfill: normalizedBackfill,
    latest: clone(history.at(-1)),
    history: clone(history),
  }
}

export function validateDataset(data) {
  if (!data || data.code !== H30269.code || data.name !== H30269.name || data.source !== 'eastmoney' || data.interval !== '1d') {
    throw new Error('Invalid H30269 dataset metadata')
  }
  if (typeof data.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data.updatedAt) || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw new Error('Invalid updatedAt')
  }
  validateHistory(data.history)
  normalizeBackfill(data.backfill, data.history)
  if (!isDeepStrictEqual(data.latest, data.history.at(-1))) throw new Error('latest must equal the last history item')
  return true
}

export async function readDataset(filePath) {
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  let data
  try {
    data = JSON.parse(text)
  } catch (cause) {
    throw new Error(`Cannot parse existing ${basename(filePath)}`, { cause })
  }
  validateDataset(data)
  return { ...data, backfill: normalizeBackfill(data.backfill, data.history) }
}

export async function atomicWriteJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = resolve(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

function stateOf(data) {
  return data ? { history: data.history, backfill: data.backfill } : null
}

function refreshEarliestState(candidate, previousEarliest) {
  const earliestDate = candidate.history[0].date
  if (earliestDate !== previousEarliest) {
    candidate.backfill.earliestDate = earliestDate
    candidate.backfill.nextEndDate = shiftDate(earliestDate, -1)
    candidate.backfill.consecutiveEmptyRanges = 0
  }
}

function isRetryableRequestError(error) {
  return error instanceof MarketDataError && (
    [403, 408, 429, 500, 502, 503, 504].includes(error.upstreamStatus) ||
    error.kind === 'timeout' ||
    error.kind === 'network'
  )
}

function blocksFurtherRequests(error) {
  return isRetryableRequestError(error)
}

function describeError(error) {
  const status = error.upstreamStatus ? ` HTTP ${error.upstreamStatus}` : ''
  return `${error.message}${status}`
}

function retryWaitMs(error, fallbackMs) {
  const retryAfterMs = Number.isFinite(error?.retryAfterSeconds) && error.retryAfterSeconds > 0
    ? error.retryAfterSeconds * 1_000
    : 0
  return Math.min(Math.max(fallbackMs, retryAfterMs), MAX_RETRY_DELAY_MS)
}

function describeWait(milliseconds) {
  return milliseconds % 1_000 === 0 ? `${milliseconds / 1_000} 秒` : `${milliseconds} 毫秒`
}

export async function fetchRangeWithRetry(instrument, bounds, {
  fetcher = fetch,
  now = new Date(),
  timeoutMs = 15_000,
  delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  retryDelaysMs = RETRY_DELAYS_MS,
  logger = console,
  label = '行情',
  onAttempt = () => {},
} = {}) {
  if (!Array.isArray(retryDelaysMs) || retryDelaysMs.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Invalid retry delays')
  }

  const maxAttempts = retryDelaysMs.length + 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onAttempt(attempt)
    try {
      const history = await fetchEastmoneyRange(instrument, bounds, { fetcher, now, timeoutMs })
      if (attempt > 1) logger.log(`${label}请求重试成功（第 ${attempt}/${maxAttempts} 次尝试）`)
      return history
    } catch (error) {
      const retryIndex = attempt - 1
      if (!isRetryableRequestError(error) || retryIndex >= retryDelaysMs.length) throw error
      const waitMs = retryWaitMs(error, retryDelaysMs[retryIndex])
      logger.warn(`${label}请求失败：${describeError(error)}；${describeWait(waitMs)}后重试（下一次 ${attempt + 1}/${maxAttempts}）`)
      await delay(waitMs)
    }
  }

  throw new Error('Unreachable retry state')
}

export async function updateH30269({
  filePath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/h30269.json'),
  fetcher = fetch,
  now = new Date(),
  timeoutMs = 15_000,
  delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  requestDelayMs = REQUEST_DELAY_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
  logger = console,
  writer = atomicWriteJson,
} = {}) {
  const existing = await readDataset(filePath)
  let candidate = existing ? clone(existing) : null
  const errors = []
  let successfulRequests = 0
  let requestCount = 0
  let stopRequests = false

  const recent = recentBounds(now)
  try {
    const history = await fetchRangeWithRetry(H30269, recent, {
      fetcher,
      now,
      timeoutMs,
      delay,
      retryDelaysMs,
      logger,
      label: '近期行情',
      onAttempt: () => { requestCount++ },
    })
    if (!history.length) throw new MarketDataError('东方财富未返回近期有效行情', { kind: 'empty_recent' })
    successfulRequests++
    if (candidate) {
      const previousEarliest = candidate.history[0].date
      candidate.history = mergeHistory(candidate.history, history)
      refreshEarliestState(candidate, previousEarliest)
    } else {
      const merged = mergeHistory(history)
      candidate = createDataset(merged, {
        earliestDate: merged[0].date,
        completed: false,
        nextEndDate: shiftDate(merged[0].date, -1),
        consecutiveEmptyRanges: 0,
      }, now.toISOString())
    }
    logger.log(`近期行情：${recent.start} 至 ${recent.end}，${history.length} 条`)
  } catch (error) {
    errors.push({ task: 'recent', error })
    stopRequests = blocksFurtherRequests(error)
    logger.warn(`近期行情更新失败：${describeError(error)}`)
  }

  if (candidate && !candidate.backfill.completed && !stopRequests) {
    if (requestCount > 0 && requestDelayMs > 0) await delay(requestDelayMs)
    const bounds = backfillBounds(candidate.backfill, candidate.history)
    try {
      const history = await fetchRangeWithRetry(H30269, bounds, {
        fetcher,
        now,
        timeoutMs,
        delay,
        retryDelaysMs,
        logger,
        label: '历史回补',
        onAttempt: () => { requestCount++ },
      })
      successfulRequests++
      if (history.length) {
        candidate.history = mergeHistory(candidate.history, history)
        candidate.backfill = {
          earliestDate: candidate.history[0].date,
          completed: false,
          nextEndDate: shiftDate(candidate.history[0].date, -1),
          consecutiveEmptyRanges: 0,
        }
        logger.log(`历史回补：${bounds.start} 至 ${bounds.end}，${history.length} 条`)
      } else {
        const consecutiveEmptyRanges = candidate.backfill.consecutiveEmptyRanges + 1
        candidate.backfill = {
          earliestDate: candidate.history[0].date,
          completed: consecutiveEmptyRanges >= EMPTY_RANGES_TO_COMPLETE,
          nextEndDate: shiftDate(bounds.start, -1),
          consecutiveEmptyRanges,
        }
        logger.log(`历史回补：${bounds.start} 至 ${bounds.end} 无数据（连续 ${consecutiveEmptyRanges}/${EMPTY_RANGES_TO_COMPLETE} 个窗口）`)
      }
    } catch (error) {
      errors.push({ task: 'backfill', error })
      logger.warn(`历史回补失败：${describeError(error)}`)
    }
  }

  if (!candidate) {
    return { changed: false, requestCount, successfulRequests, errors, reason: 'no_valid_data' }
  }

  candidate.backfill.earliestDate = candidate.history[0].date
  candidate.latest = clone(candidate.history.at(-1))
  const changed = !isDeepStrictEqual(stateOf(existing), stateOf(candidate))
  if (!changed) {
    logger.log('H30269 数据无变化，跳过更新')
    return { changed: false, requestCount, successfulRequests, errors, data: existing }
  }

  const output = createDataset(candidate.history, candidate.backfill, now.toISOString())
  validateDataset(output)
  await writer(filePath, output)
  logger.log(`H30269 数据已更新：共 ${output.history.length} 条，最新 ${output.latest.date}`)
  return { changed: true, requestCount, successfulRequests, errors, data: output }
}

async function main() {
  const verbose = process.argv.includes('--verbose')
  if (verbose) console.log(`数据文件：${resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/h30269.json')}`)
  const result = await updateH30269()
  if (verbose) console.log(`请求 ${result.requestCount} 次，成功 ${result.successfulRequests} 次，数据${result.changed ? '已写入' : '未重写'}`)
  if (result.errors.length) process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`H30269 数据更新失败：${error.message}`)
    process.exitCode = 1
  })
}
