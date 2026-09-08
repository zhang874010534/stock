import test from 'node:test'
import assert from 'node:assert/strict'
import { getYield } from '../src/api/yields.js'

const valid = { code: 'H30269', basis: 'total_share_capital', unit: 'percent', date: '2026-09-08', value: 4.27 }
test('收益率保留百分数口径，验证指标身份和日期', async () => {
  assert.deepEqual(await getYield('dividend', { fetcher: async () => Response.json(valid) }), valid)
  for (const patch of [{ code: 'CN10Y' }, { basis: 'free_float' }, { unit: 'ratio' }, { value: null }, { date: '2026-02-30' }]) {
    await assert.rejects(getYield('dividend', { fetcher: async () => Response.json({ ...valid, ...patch }) }))
  }
})
test('收益率文件缺失时显示失败，不返回假数值', async () => {
  await assert.rejects(getYield('treasury', { fetcher: async () => new Response('', { status: 404 }) }))
})
