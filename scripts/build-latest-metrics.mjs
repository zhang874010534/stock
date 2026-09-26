import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildLatestMetrics } from '../src/utils/latestMetrics.js'

const defaultDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')

export async function generateLatestMetrics({ directory = defaultDirectory, now = new Date(), calendar, inputErrors = {} } = {}) {
  let status = { schemaVersion: 1, errors: {} }
  try { status = JSON.parse(await readFile(resolve(directory, 'latest-metrics-source-status.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (status.schemaVersion !== 1 || !status.errors || Object.entries(status.errors).some(([key, value]) => !['market', 'valuation', 'dividend'].includes(key) || typeof value !== 'string' || !value)) throw new Error('指标来源状态文件无效')
  const errors = { ...status.errors, ...inputErrors }
  const filenames = { market: 'h30269.json', valuation: 'valuation-h30269.json', dividend: 'dividend-h30269.json', previous: 'latest-metrics-h30269.json' }
  const inputs = {}
  const hashes = {}
  const reads = await Promise.allSettled(Object.entries(filenames).map(async ([key, filename]) => {
    const raw = await readFile(resolve(directory, filename), 'utf8')
    return { key, raw, data: JSON.parse(raw) }
  }))
  for (const [index, result] of reads.entries()) {
    const key = Object.keys(filenames)[index]
    if (result.status === 'fulfilled') {
      inputs[key] = result.value.data
      hashes[key] = createHash('sha256').update(result.value.raw).digest('hex')
    } else if (key !== 'previous') errors[key] ??= `无法读取 ${filenames[key]}：${result.reason.message}`
    else if (result.reason.code !== 'ENOENT') throw new Error(`无法读取已有统一指标文件，停止覆盖：${result.reason.message}`)
  }
  const data = buildLatestMetrics({ ...inputs, inputErrors: errors, calendar, now })
  if (data.calculation && data.metrics.annualReturn.status === 'ok') data.calculation.inputSummary.sha256 = hashes.market
  // Keep generatedAt stable when the actual values, provenance and states do not change.
  const comparable = value => JSON.stringify({ ...value, generatedAt: undefined })
  const failed = Object.values(data.metrics).some(item => item.status === 'stale' || (item.status === 'unavailable' && item.reason !== '样本不足或波动为零'))
  if (inputs.previous && comparable(inputs.previous) === comparable(data)) return { data: inputs.previous, changed: false, failed }
  const target = resolve(directory, filenames.previous)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, target)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  return { data, changed: true, failed }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  generateLatestMetrics().then(({ data, changed, failed }) => {
    console.log(`H30269 最新指标：${changed ? '已生成' : '无变化'}；计算截至 ${data.calculation?.windowEnd ?? '暂无'}`)
    for (const [key, item] of Object.entries(data.metrics)) if (item.status !== 'ok') console.warn(`${key}: ${item.status} — ${item.reason}`)
    if (failed) process.exitCode = 1
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
