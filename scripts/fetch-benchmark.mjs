import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { CSI300, isValidDate, mergeHistory, shanghaiDate, shiftDate } from './lib/market-data.mjs'
import { atomicWriteJson, createDataset, readDataset, fetchRangeWithRetry, updateH30269, describeError } from './fetch-h30269.mjs'
import { validateSourceStatus } from '../src/utils/sourceStatus.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// An initial bounded download supplies the comparison window immediately;
// the regular market workflow continues the existing incremental backfill.
export async function refreshBenchmark({ directory = resolve(root, 'public/data'), bootstrap = false,
  start = '2022-12-01', end, now = new Date(), fetcher = fetch, retryDelaysMs, logger = console,
} = {}) {
  end ??= shanghaiDate(now)
  const filePath = resolve(directory, '000300.json'), statusPath = resolve(directory, 'dashboard-source-status.json')
  let status = { schemaVersion: 1, sources: {} }
  try { status = validateSourceStatus(JSON.parse(await readFile(statusPath, 'utf8'))) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  let result, failure
  try {
    if (bootstrap) {
      if (!isValidDate(start) || !isValidDate(end) || start > end || end > shanghaiDate(now)) throw new Error('初始化日期区间无效')
      const existing = await readDataset(filePath, CSI300)
      const fetched = await fetchRangeWithRetry(CSI300, { start, end }, { now, fetcher, retryDelaysMs, logger, label: '沪深300初始化' })
      if (!fetched.length) throw new Error('沪深300未返回有效行情')
      const history = mergeHistory(existing?.history ?? [], fetched)
      const earliestDate = history[0].date
      const backfill = existing && earliestDate === existing.history[0].date ? existing.backfill
        : { earliestDate, completed: false, nextEndDate: shiftDate(earliestDate, -1), consecutiveEmptyRanges: 0 }
      const data = createDataset(history, backfill, now.toISOString(), CSI300)
      await atomicWriteJson(filePath, data)
      result = { data, changed: true }
    } else {
      result = await updateH30269({ instrument: CSI300, filePath, now, fetcher, retryDelaysMs, logger })
      if (!result.data || result.errors.some(entry => entry.task === 'recent')) throw new Error('沪深300近期行情更新失败')
    }
  } catch (error) { failure = error }
  status.sources['000300'] = {
    status: failure ? 'error' : 'ok', lastAttemptAt: now.toISOString(),
    lastSuccessAt: failure ? status.sources['000300']?.lastSuccessAt ?? null : now.toISOString(),
    error: failure ? describeError(failure) : null,
  }
  await atomicWriteJson(statusPath, status)
  if (failure) throw failure
  return result
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  refreshBenchmark({ bootstrap: process.argv.includes('--bootstrap') }).then(({ data }) => {
    console.log(`沪深300：${data.history.length} 个样本，${data.history[0].date} 至 ${data.latest.date}`)
  }).catch(error => { console.error(describeError(error)); process.exitCode = 1 })
}
