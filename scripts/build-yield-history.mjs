import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { emptyYieldHistory, mergeYieldHistory, validateYieldHistory, YIELD_SERIES } from '../src/utils/yieldSpread.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function generateYieldHistory({ directory = resolve(root, 'public/data'), now = new Date(), inputErrors = {}, seedGit = false } = {}) {
  const target = resolve(directory, 'yield-history-h30269-cn10y.json')
  let previous
  try { previous = validateYieldHistory(JSON.parse(await readFile(target, 'utf8')), { now }) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`收益率历史损坏，停止覆盖：${error.message}`) }
  let data = previous ?? emptyYieldHistory()
  if (seedGit) {
    const saved = data
    data = emptyYieldHistory()
    // Replay genuine committed snapshots in chronological commit order. No
    // interpolation or current-value backfill; same-date corrections replace.
    for (const [kind, metadata] of Object.entries(YIELD_SERIES)) {
      const path = `public/data/${metadata.filename}`
      const commits = execFileSync('git', ['log', '--reverse', '--format=%H', '--', path], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
      for (const commit of commits) {
        const snapshot = JSON.parse(execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, encoding: 'utf8' }))
        data = mergeYieldHistory(data, { [kind]: snapshot }, { now })
      }
    }
    // Reseeding fills earlier observations without undoing already archived
    // corrections. Current input files are merged below as the newest evidence.
    for (const kind of Object.keys(YIELD_SERIES)) {
      const rows = new Map(data.series[kind].history.map(point => [point.date, point]))
      for (const point of saved.series[kind].history) rows.set(point.date, point)
      data.series[kind].history = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
    }
  }
  const errors = {}
  for (const [kind, metadata] of Object.entries(YIELD_SERIES)) {
    if (inputErrors[kind]) { errors[kind] = typeof inputErrors[kind] === 'string' ? inputErrors[kind] : '来源采集失败，保留已有历史'; continue }
    try {
      const snapshot = JSON.parse(await readFile(resolve(directory, metadata.filename), 'utf8'))
      const last = data.series[kind].history.at(-1)
      if (last && snapshot.date < last.date) throw new Error('最新收益率日期倒退')
      data = mergeYieldHistory(data, { [kind]: snapshot }, { now })
    } catch (error) { errors[kind] = error.message }
  }
  const changed = JSON.stringify(data) !== JSON.stringify(previous)
  if (changed) {
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' })
      await rename(temporary, target)
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  return { data, changed, failed: Object.keys(errors).length > 0, errors }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  generateYieldHistory({ seedGit: process.argv.includes('--seed-git') }).then(result => {
    console.log(`收益率历史：${result.changed ? '已更新' : '无变化'}；股息率 ${result.data.series.dividend.history.length} 条，国债 ${result.data.series.treasury.history.length} 条`)
    if (result.failed) { console.error(result.errors); process.exitCode = 1 }
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
