import { INDEX_CODE, DEFAULT_HISTORY_START, ensureSchema, readCoverage, saveWindow, addDays } from './database.js'

const SOURCE_URL = 'https://www.csindex.com.cn/csindex-home/perf/index-perf'
const MAX_REQUESTS = 2
const REQUEST_GAP_MS = 30000

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

export function localDay(now) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
}

function maxDate(a, b) { return a > b ? a : b }
function minDate(a, b) { return a < b ? a : b }

export function previousMonthStart(end) {
  const date = new Date(`${end}T00:00:00Z`)
  const lastPrevious = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0))
  lastPrevious.setUTCDate(Math.min(date.getUTCDate(), lastPrevious.getUTCDate()))
  return addDays(lastPrevious.toISOString().slice(0, 10), 1)
}

export function nextBackfill(coverage, floor) {
  // Fill gaps caused by outages before working backwards into older history.
  for (let index = coverage.length - 1; index > 0; index--) {
    const start = maxDate(addDays(coverage[index - 1].end, 1), floor)
    const end = addDays(coverage[index].start, -1)
    if (start <= end) return { start: maxDate(start, previousMonthStart(end)), end }
  }
  const end = coverage.length ? addDays(coverage[0].start, -1) : null
  return end && end >= floor ? { start: maxDate(floor, previousMonthStart(end)), end } : null
}

class SourceError extends Error {
  constructor(message, { paused = false, retryAfter = null } = {}) {
    super(message)
    this.paused = paused
    this.retryAfter = retryAfter
  }
}

function retryAt(header, now) {
  const seconds = header && /^\d+$/.test(header.trim()) ? Number(header) : NaN
  const time = Number.isFinite(seconds) ? now.getTime() + seconds * 1000 : Date.parse(header)
  return new Date(Number.isFinite(time) && time > now.getTime() ? time : now.getTime() + 86400000).toISOString()
}

export function parseRows(payload, range) {
  if (String(payload?.code) !== '200' || !Array.isArray(payload.data)) {
    throw new SourceError('数据源返回异常，已保留原数据和同步进度')
  }
  const rows = new Map()
  for (const item of payload.data) {
    const raw = String(item?.tradeDate ?? '')
    const date = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : ''
    const close = typeof item?.close === 'number' || (typeof item?.close === 'string' && item.close.trim()) ? Number(item.close) : NaN
    if (item?.indexCode !== INDEX_CODE || !isDate(date) || date < range.start || date > range.end || !Number.isFinite(close) || close <= 0) {
      throw new SourceError('数据源包含无效记录，已停止本轮同步')
    }
    rows.set(date, { date, close })
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function fetchWindow(range, fetcher, now) {
  const url = new URL(SOURCE_URL)
  url.searchParams.set('indexCode', INDEX_CODE)
  url.searchParams.set('startDate', range.start.replaceAll('-', ''))
  url.searchParams.set('endDate', range.end.replaceAll('-', ''))
  let response
  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
      redirect: 'manual',
    })
  } catch {
    throw new SourceError('数据源请求失败或超时，等待下一次定时任务')
  }
  if (response.status === 403) throw new SourceError('数据源拒绝访问（403），同步已暂停，请检查后手动恢复', { paused: true })
  if (response.status === 429) throw new SourceError('数据源限流（429），已停止请求并进入等待', { retryAfter: retryAt(response.headers.get('Retry-After'), now) })
  if (!response.ok) throw new SourceError(`数据源 HTTP ${response.status}，等待下一次定时任务`)
  try {
    return parseRows(await response.json(), range)
  } catch (error) {
    if (error instanceof SourceError) throw error
    throw new SourceError('数据源未返回有效 JSON，已停止本轮同步')
  }
}

export async function syncIndex(env, dependencies = {}) {
  if (env.SYNC_ENABLED === 'false') return { status: 'disabled' }
  if (!env.DB) throw new Error('缺少 D1 数据库绑定 DB')
  const now = dependencies.now ?? (() => new Date())
  const fetcher = dependencies.fetch ?? fetch
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const started = now()
  const today = localDay(started)
  const floor = env.HISTORY_START_DATE ?? DEFAULT_HISTORY_START
  if (!isDate(floor) || floor > today) throw new Error('HISTORY_START_DATE 必须是有效的历史日期 YYYY-MM-DD')
  await ensureSchema(env.DB)
  const state = await env.DB.prepare('SELECT * FROM index_sync_state WHERE code = ?').bind(INDEX_CODE).first()
  if (state.paused) return { status: 'paused' }
  if (state.retry_after && Date.parse(state.retry_after) > started.getTime()) return { status: 'cooldown' }

  // One durable claim per Beijing calendar day, including failed/crashed attempts.
  // Duplicate cron deliveries and concurrent invocations cannot start another run.
  const claim = await env.DB.prepare(`INSERT INTO index_sync_runs (code, run_date, started_at)
    VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).bind(INDEX_CODE, today, started.toISOString()).run()
  if (claim.meta.changes === 0) return { status: 'already_ran' }

  let requests = 0
  let written = 0
  try {
    const coverage = await readCoverage(env.DB)
    const bootstrap = coverage.length === 0
    const recent = { start: maxDate(floor, addDays(today, bootstrap ? -29 : -6)), end: today }

    async function collect(range) {
      // Increment before I/O; failures count towards the daily request budget too.
      if (requests >= MAX_REQUESTS) throw new Error('已达到每日请求上限')
      requests++
      await env.DB.prepare('UPDATE index_sync_runs SET request_count = ? WHERE code = ? AND run_date = ?')
        .bind(requests, INDEX_CODE, today).run()
      const rows = await fetchWindow(range, fetcher, now())
      if (!rows.length) {
        // A successful empty response is normal for short holiday-only windows.
        // A whole empty month is suspicious: do not silently skip that history.
        const days = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1
        if (days > 10 || bootstrap) throw new SourceError('数据源未返回该区间的数据，已保留进度，等待后续重试')
      }
      await saveWindow(env.DB, range, rows, now().toISOString())
      written += rows.length
      await env.DB.prepare('UPDATE index_sync_runs SET rows_written = ? WHERE code = ? AND run_date = ?')
        .bind(written, INDEX_CODE, today).run()
    }

    await collect(recent)
    if (!bootstrap) {
      const backfill = nextBackfill(await readCoverage(env.DB), floor)
      if (backfill) {
        await sleep(REQUEST_GAP_MS)
        await collect({ start: backfill.start, end: minDate(backfill.end, today) })
      }
    }
    await env.DB.prepare("UPDATE index_sync_runs SET status = 'ok', finished_at = ? WHERE code = ? AND run_date = ?")
      .bind(now().toISOString(), INDEX_CODE, today).run()
    return { status: 'ok', requests, rows: written }
  } catch (error) {
    const message = error instanceof SourceError ? error.message : '同步写入失败，已保留已提交的数据；请查看 Worker 日志'
    await env.DB.batch([
      env.DB.prepare('UPDATE index_sync_state SET paused = ?, retry_after = ?, last_error = ? WHERE code = ?')
        .bind(error.paused ? 1 : 0, error.retryAfter ?? null, message, INDEX_CODE),
      env.DB.prepare("UPDATE index_sync_runs SET status = 'failed', error = ?, finished_at = ? WHERE code = ? AND run_date = ?")
        .bind(message, now().toISOString(), INDEX_CODE, today),
    ])
    console.error('H30269 sync failed', error)
    throw error
  }
}
