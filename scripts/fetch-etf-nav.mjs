import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEtfNav } from './lib/etf-nav.mjs'
import { ETF_NAV_SOURCE, ETF_NAV_DATA_SOURCE, validateEtfNav } from '../src/utils/etfNav.js'

const OUTPUT = new URL('../public/data/nav-512890.json', import.meta.url)
async function save(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
export async function refreshEtfNav({ output = OUTPUT, fetcher = fetch, now = new Date() } = {}) {
  const path = output instanceof URL ? fileURLToPath(output) : resolve(output)
  let old = null
  try { old = validateEtfNav(JSON.parse(await readFile(path, 'utf8')), { now }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  try {
    const response = await fetcher(ETF_NAV_DATA_SOURCE, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Mozilla/5.0', Referer: ETF_NAV_SOURCE } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = parseEtfNav(await response.text(), now)
    if (old && old.status !== 'unavailable') {
      const dates = new Set(data.history.map(row => row.date))
      if (data.date < old.date || old.history.some(row => !dates.has(row.date))) throw new Error('净值日期倒退或已保存历史消失，需核验来源')
    }
    await save(path, data); return { ok: true, data }
  } catch (error) {
    const data = old && old.status !== 'unavailable' ? { ...old, status: 'stale', reason: 'ETF 净值采集失败，保留原数据及成功时间', lastAttemptAt: now.toISOString() } : {
      schemaVersion: 1, code: '512890', provider: 'Eastmoney', source: ETF_NAV_SOURCE, dataSource: ETF_NAV_DATA_SOURCE, unit: 'CNY_per_share', basis: 'unit_nav', status: 'unavailable', reason: 'ETF 净值采集失败，暂无可用记录', lastAttemptAt: now.toISOString(), lastSuccessAt: null, date: null, history: [] }
    validateEtfNav(data, { now }); await save(path, data); return { ok: false, data, error: error.message }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await refreshEtfNav()
  console.log(result.ok ? `512890: ${result.data.history.length} NAV observations; through ${result.data.date}` : result.error)
  process.exitCode = result.ok ? 0 : 1
}
