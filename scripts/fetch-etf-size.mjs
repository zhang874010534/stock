import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEtfSize } from './lib/etf-size.mjs'
import { ETF_SIZE_SOURCE, ETF_SIZE_DATA_SOURCE, validateEtfSize } from '../src/utils/etfLiquidity.js'
const OUTPUT = new URL('../public/data/size-512890.json', import.meta.url)
async function save(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
export async function refreshEtfSize({ output = OUTPUT, fetcher = fetch, now = new Date() } = {}) {
  const path = output instanceof URL ? fileURLToPath(output) : resolve(output)
  let old = null
  try { old = validateEtfSize(JSON.parse(await readFile(path, 'utf8')), { now }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  try {
    const response = await fetcher(ETF_SIZE_DATA_SOURCE, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Mozilla/5.0', Referer: ETF_SIZE_SOURCE } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = parseEtfSize(await response.text(), now)
    if (old?.date && data.date < old.date) throw new Error('规模日期倒退，需核验来源')
    const history = new Map((old?.history ?? []).map(row => [row.date, row]))
    for (const row of data.history) history.set(row.date, row)
    data.history = [...history.values()].sort((a, b) => a.date.localeCompare(b.date))
    validateEtfSize(data, { now }); await save(path, data); return { ok: true, data }
  } catch (error) {
    const data = old && old.status !== 'unavailable' ? { ...old, status: 'stale', reason: 'ETF 规模采集失败，保留原报告期记录', lastAttemptAt: now.toISOString() } : {
      schemaVersion: 1, code: '512890', provider: 'Eastmoney', source: ETF_SIZE_SOURCE, dataSource: ETF_SIZE_DATA_SOURCE, unit: 'CNY', basis: 'reported_net_assets', status: 'unavailable', reason: 'ETF 规模采集失败，暂无可用记录', lastAttemptAt: now.toISOString(), lastSuccessAt: null, date: null, history: [] }
    validateEtfSize(data, { now }); await save(path, data); return { ok: false, data, error: error.message }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await refreshEtfSize()
  console.log(result.ok ? `512890: ${result.data.history.length} size reports; through ${result.data.date}` : result.error)
  process.exitCode = result.ok ? 0 : 1
}
