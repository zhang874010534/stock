import test from 'node:test'
import assert from 'node:assert/strict'
import { updateMarket } from '../scripts/fetch-market.mjs'
import { describeError } from '../scripts/fetch-h30269.mjs'
import { MarketDataError } from '../scripts/lib/market-data.mjs'

const success = () => ({ errors: [], data: { backfill: { completed: false } } })
const logger = { log() {}, warn() {}, error() {} }

test('两个标的的近期更新均优先于历史回补，阶段间保留请求间隔', async () => {
  const calls = []
  const waits = []
  const result = await updateMarket({ logger,
    delay: async (ms) => waits.push(ms),
    updater: async ({ instrument, phase }) => { calls.push(`${instrument.code}:${phase}`); return success() },
  })
  assert.equal(result.failed, false)
  assert.deepEqual(calls, ['H30269:recent', '512890:recent', 'H30269:backfill', '512890:backfill'])
  assert.deepEqual(waits, [3000, 3000, 3000])
})

test('仅历史回补失败给出警告，仍继续其他标的回补', async () => {
  const warnings = []
  let backfills = 0
  const result = await updateMarket({ logger: { ...logger, warn: (message) => warnings.push(message) }, requestDelayMs: 0,
    updater: async ({ phase }) => {
      if (phase === 'backfill') { backfills++; return { errors: [{ task: 'backfill' }] } }
      return success()
    },
  })
  assert.equal(result.failed, false)
  assert.equal(backfills, 2)
  assert.equal(warnings.length, 2)
  assert.match(warnings[0], /::warning::H30269/)
})

test('近期失败保留失败状态并跳过该标的回补，不阻止其他标的更新', async () => {
  const calls = []
  const result = await updateMarket({ logger, requestDelayMs: 0,
    updater: async ({ instrument, phase }) => {
      calls.push(`${instrument.code}:${phase}`)
      return instrument.code === 'H30269' ? { errors: [{ task: 'recent' }] } : success()
    },
  })
  assert.equal(result.failed, true)
  assert.deepEqual(calls, ['H30269:recent', '512890:recent', '512890:backfill'])
})

test('回补文件异常不能降级为成功，且仍继续处理其他标的', async () => {
  let backfills = 0
  const result = await updateMarket({ logger, requestDelayMs: 0,
    updater: async ({ phase }) => {
      if (phase === 'backfill') { backfills++; throw new Error('write failed') }
      return success()
    },
  })
  assert.equal(result.failed, true)
  assert.equal(backfills, 2)
})

test('历史已补齐时不再请求回补', async () => {
  const phases = []
  const result = await updateMarket({ logger, requestDelayMs: 0,
    updater: async ({ phase }) => { phases.push(phase); return { errors: [], data: { backfill: { completed: true } } } },
  })
  assert.equal(result.failed, false)
  assert.deepEqual(phases, ['recent', 'recent'])
})

test('网络诊断包含嵌套和聚合错误码，不输出地址等底层明细', () => {
  const cause = new TypeError('fetch failed', { cause: new AggregateError([
    Object.assign(new Error('private address'), { code: 'ECONNRESET' }),
    Object.assign(new Error('private address'), { code: 'ENOTFOUND' }),
  ]) })
  const error = new MarketDataError('网络请求失败', { kind: 'network', cause })
  assert.equal(describeError(error), '网络请求失败 [ECONNRESET, ENOTFOUND]')
})
