import { readFile, writeFile, rename, unlink, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { updateMarket } from './fetch-market.mjs'
import { generateLatestMetrics } from './build-latest-metrics.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function updateIndicators() {
  const temporary = await mkdtemp(join(tmpdir(), 'stock-indicators-'))
  const report = join(temporary, 'report.json')
  try {
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn(process.env.PYTHON ?? 'python', [join(root, 'scripts/fetch-indicators.py')], {
        cwd: root, stdio: 'inherit', env: { ...process.env, METRICS_UPDATE_REPORT: report },
      })
      child.on('error', reject)
      child.on('close', resolveExit)
    })
    const data = JSON.parse(await readFile(report, 'utf8'))
    return { failed: code !== 0, sources: data.sources }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

// Keep source failures across the two independent schedules. Only an explicitly
// successful attempt for that source may clear its failure state.
export async function refreshLatestMetrics({ mode, directory = join(root, 'public/data'), now = new Date(),
  marketUpdater = updateMarket, indicatorUpdater = updateIndicators,
} = {}) {
  if (!['market', 'indicators'].includes(mode)) throw new Error('更新模式必须为 market 或 indicators')
  const statusPath = join(directory, 'latest-metrics-source-status.json')
  let status = { schemaVersion: 1, errors: {} }
  try { status = JSON.parse(await readFile(statusPath, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (status.schemaVersion !== 1 || !status.errors || Object.entries(status.errors).some(([key, value]) => !['market', 'valuation', 'dividend'].includes(key) || typeof value !== 'string' || !value)) throw new Error('指标来源状态文件无效')
  const keys = mode === 'market' ? { market: 'H30269' } : { valuation: 'valuation', dividend: 'dividend' }
  let result
  try { result = await (mode === 'market' ? marketUpdater() : indicatorUpdater()) }
  catch { result = { failed: true, sources: {} } }
  for (const [key, reportKey] of Object.entries(keys)) {
    const outcome = result?.sources?.[reportKey]
    if (outcome === null) delete status.errors[key]
    else status.errors[key] = typeof outcome === 'string' && outcome ? outcome : '上游更新未返回有效状态'
  }
  const temporary = `${statusPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, statusPath)
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  const generated = await generateLatestMetrics({ directory, now })
  return { ...generated, failed: Boolean(result?.failed) || generated.failed }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  refreshLatestMetrics({ mode: process.argv[2] }).then(result => {
    console.log(`统一指标：${result.changed ? '已更新' : '无变化'}；${result.failed ? '部分来源或计算失败，已保留可用数据' : '成功'}`)
    if (result.failed) process.exitCode = 1
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
