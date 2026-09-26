import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getConstituents } from '../src/api/constituents.js'

test('official snapshot is readable; corrupt and duplicate membership is rejected', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/constituents-h30269.json', import.meta.url), 'utf8'))
  const result = await getConstituents({ fetcher: async () => Response.json(data) })
  assert.equal(result.count, 50)
  assert.equal(result.members[0].code, '000001')
  for (const mutate of [d => { d.code = '512890' }, d => { d.members.pop() }, d => { d.members[1].code = d.members[0].code }, d => { d.date = '2999-01-01' }]) {
    const bad = structuredClone(data); mutate(bad)
    await assert.rejects(getConstituents({ fetcher: async () => Response.json(bad) }))
  }
  await assert.rejects(getConstituents({ fetcher: async () => new Response('', { status: 503 }) }))
})
