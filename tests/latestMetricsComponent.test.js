import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'

async function mountSfc(name, props = {}) {
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'metrics-component-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, children: [], props: {}, text: '' })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host')
  const app = renderer.createApp(component, props)
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { app, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), button: () => all(host).find(n => n.tag === 'button') }
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }

test('latest metrics loading, initial failure, retry, stale and unavailable values, retained data', async () => {
  const previousFetch = globalThis.fetch
  let mounted
  let resolveRequest
  try {
    globalThis.fetch = () => new Promise(resolve => { resolveRequest = resolve })
    mounted = await mountSfc('LatestIndexMetrics', { instrument: '512890' })
    assert.match(mounted.text(), /正在读取最新指标/)
    assert.equal(mounted.button().props.disabled, true)
    resolveRequest(new Response('', { status: 503 }))
    await flush()
    assert.match(mounted.text(), /指标读取失败，请重试/)
    assert.ok(!mounted.text().includes('NaN'))
    const payload = JSON.parse(await readFile(new URL('../public/data/latest-metrics-h30269.json', import.meta.url), 'utf8'))
    payload.metrics.pe.status = 'stale'; payload.metrics.pe.reason = '上游失败'
    payload.metrics.pb.status = 'unavailable'; payload.metrics.pb.value = null; payload.metrics.pb.asOf = null; payload.metrics.pb.reason = '暂无估值'
    globalThis.fetch = async url => {
      assert.match(url, /^\/data\/latest-metrics-h30269.json\?t=/)
      return Response.json(payload)
    }
    await mounted.button().props.onClick()
    await flush()
    assert.match(mounted.text(), /标的指数最新指标/)
    assert.match(mounted.text(), /更新失败，保留上次数据/)
    assert.match(mounted.text(), /暂无估值/)
    assert.match(mounted.text(), /无风险利率假设 0%/)
    assert.match(mounted.text(), /全部历史/)
    assert.ok(mounted.nodes().some(n => n.tag === 'summary' && n.text === '查看指标说明'))
    assert.match(mounted.text(), /日收益样本标准差 × √252/)
    assert.ok(!mounted.text().includes('近一年'))
    assert.ok(mounted.text().includes(payload.calculation.windowStart))
    assert.ok(mounted.text().includes(payload.calculation.windowEnd))
    assert.equal(mounted.nodes().filter(n => n.props.class === 'metric-row').length, 6)
    const before = mounted.nodes().filter(n => n.props.class === 'metric-value').map(n => n.text)
    assert.equal(before[1], '—')
    assert.ok(!before[5].includes('%'))
    globalThis.fetch = async () => { throw new Error('offline') }
    await mounted.button().props.onClick()
    await flush()
    assert.match(mounted.text(), /指标读取失败，保留上次数据及日期/)
    assert.deepEqual(mounted.nodes().filter(n => n.props.class === 'metric-value').map(n => n.text), before)
  } finally { mounted?.app.unmount(); globalThis.fetch = previousFetch }
})

test('treasury-only sidebar omits duplicate dividend and does not request it; homepage keeps both', async () => {
  const previousFetch = globalThis.fetch
  let mounted
  const requested = []
  try {
    globalThis.fetch = async url => {
      requested.push(url)
      return Response.json(url.includes('china-bond')
        ? { code: 'CN10Y', basis: 'government_bond_yield_curve_10y', unit: 'percent', date: '2026-09-18', value: 1.682 }
        : { code: 'H30269', basis: 'total_share_capital', unit: 'percent', date: '2026-09-18', value: 4.31 })
    }
    mounted = await mountSfc('YieldMetricCard', { showDividend: false, instrument: '512890' })
    await flush()
    assert.equal(requested.length, 1)
    assert.match(requested[0], /china-bond-10y/)
    assert.match(mounted.text(), /中国十年期国债收益率/)
    assert.ok(!mounted.text().includes('股息率'))
    mounted.app.unmount(); mounted = null; requested.length = 0
    mounted = await mountSfc('YieldMetricCard')
    await flush()
    assert.equal(requested.length, 2)
    assert.match(mounted.text(), /标的指数股息率/)
    assert.match(mounted.text(), /4.31%/)
  } finally { mounted?.app.unmount(); globalThis.fetch = previousFetch }
})
