import test from 'node:test'
import assert from 'node:assert/strict'
import { getValuation, VALUATION_SOURCE } from '../src/api/valuations.js'

const valid = { code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE,
  basis: 'provider_unspecified', unit: 'multiple', date: '2026-09-18', pe: 8.37889046, pb: 0.777 }

test('指数估值保留原始精度，并验证来源、日期和数值', async () => {
  assert.deepEqual(await getValuation({ fetcher: async () => Response.json(valid) }), valid)
  for (const patch of [{ code: '512890' }, { provider: 'CSI' }, { source: 'https://example.com' },
    { basis: 'ttm' }, { date: '2026-02-30' }, { date: '2999-01-01' }, { pe: null },
    { pb: 0 }, { pe: '8.37' }, { pb: -1 }]) {
    await assert.rejects(getValuation({ fetcher: async () => Response.json({ ...valid, ...patch }) }))
  }
})

test('缺文件或空响应不会生成默认估值', async () => {
  await assert.rejects(getValuation({ fetcher: async () => new Response('', { status: 404 }) }))
  await assert.rejects(getValuation({ fetcher: async () => Response.json(null) }))
})
