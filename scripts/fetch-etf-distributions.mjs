import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEtfDistributions } from './lib/etf-distributions.mjs'
import { ETF_DISTRIBUTION_SOURCE, validateEtfDistributions } from '../src/utils/etfDistributions.js'

const OUTPUT = new URL('../public/data/distributions-512890.json', import.meta.url)
async function save(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
export async function refreshEtfDistributions({ output = OUTPUT, fetcher = fetch, now = new Date() } = {}) {
  const path = output instanceof URL ? (await import('node:url')).fileURLToPath(output) : resolve(output)
  let old = null
  try { old = validateEtfDistributions(JSON.parse(await readFile(path, 'utf8')), { now }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  try {
    const response = await fetcher(ETF_DISTRIBUTION_SOURCE, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fund.eastmoney.com/512890.html' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = await response.text()
    if (html.length > 4 * 1024 * 1024) throw new Error('分红页面超限')
    const data = parseEtfDistributions(html, now)
    if (old && old.status !== 'unavailable') {
      if (data.coverage.end < old.coverage.end) throw new Error('核验日期倒退')
      for (const kind of ['dividends', 'splits']) {
        if (old[kind].some(item => !data[kind].some(value => JSON.stringify(value) === JSON.stringify(item)))) throw new Error('已保存分红或拆分记录消失／改变，需人工核验')
      }
    }
    await save(path, data)
    return { ok: true, data }
  } catch (error) {
    const data = old && old.status !== 'unavailable' ? { ...old, status: 'stale', reason: 'ETF 分红采集失败，保留原核验范围和记录' } : {
      schemaVersion: 1, code: '512890', unit: 'CNY_per_share', source: ETF_DISTRIBUTION_SOURCE,
      coverage: null, checkedAt: null, dividends: [], splits: [], status: 'unavailable', reason: 'ETF 分红采集失败，暂无已核验记录' }
    await save(path, data)
    return { ok: false, data, error: error.message }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await refreshEtfDistributions()
  console.log(result.ok ? `512890: ${result.data.dividends.length} cash distributions, ${result.data.splits.length} splits; checked through ${result.data.coverage.end}` : result.error)
  process.exitCode = result.ok ? 0 : 1
}
