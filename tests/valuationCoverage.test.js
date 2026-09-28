import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { MIN_VALUATION_SAMPLES, valuationCoverage, valuationStats } from '../src/utils/valuationStats.js'

const history = Array.from({ length: 21 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, pe: 8 + i / 100, pb: .8 }))
const modules = new Map()
async function componentUrl(file) {
  if (modules.has(file.href)) return modules.get(file.href)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'coverage-test', inlineTemplate: true }).content
  // Only chart drawing is stubbed; coverage and source-switching components run normally.
  script = script.replace(/import ValuationTrend from ['"][^'"]+['"]/, "const ValuationTrend = { render: () => null }")
  const imports = [...script.matchAll(/from (['"])([^'"]+)\1/g)]
  for (const [original, , specifier] of imports) {
    const url = specifier.endsWith('.vue') ? await componentUrl(new URL(specifier, file))
      : specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)
    script = script.replace(original, `from '${url}'`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(script).toString('base64')}`
  modules.set(file.href, url)
  return url
}
async function mount(name, props) {
  const component = (await import(await componentUrl(new URL(`../src/components/${name}.vue`, import.meta.url)))).default
  const node = tag => ({ tag, children: [], props: {}, text: '', close() {}, addEventListener() {},
    get options() { return this.children.filter(child => child.tag === 'option') } })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), app = renderer.createApp(component, props)
  const instance = app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { app, instance, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' ') }
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }

test('coverage uses selected effective samples and caps only the threshold progress', () => {
  for (const count of [0, 5, 19, 20, 21]) {
    const stats = valuationStats(history.slice(0, count), 'pe', 'all')
    const coverage = valuationCoverage(stats)
    assert.equal(coverage.remaining, Math.max(0, 20 - count))
    assert.equal(coverage.progress, Math.min(20, count))
    assert.equal(coverage.calendarDays, count)
    assert.equal(stats.rank === null, count < MIN_VALUATION_SAMPLES)
  }
  const stats = valuationStats([{ date: '2024-01-01', pe: 7 }, ...history.slice(0, 5)], 'pe', '1y')
  assert.equal(stats.count, 5)
  assert.equal(valuationCoverage(stats).firstDate, '2026-08-01')
  assert.equal(valuationCoverage(stats).remaining, 15)
})

test('coverage explains empty, accumulating, threshold, partial, loading and retained-error states', async () => {
  for (const count of [0, 5, 19, 20, 21]) {
    const mounted = await mount('ValuationCoverage', { stats: valuationStats(history.slice(0, count), 'pe', '1y'), range: '1y' })
    try {
      assert.match(mounted.text(), /不是历史完整率/)
      const progress = mounted.nodes().find(n => n.tag === 'progress')
      assert.equal(progress.props.value, Math.min(20, count))
      if (!count) assert.match(mounted.text(), /暂无可用历史/)
      else {
        assert.match(mounted.text(), /2026-08-01/)
        assert.match(mounted.text(), /尚未覆盖所选近1年/)
        if (count < 20) assert.ok(mounted.text().includes(`还需 ${20 - count} 个有效日样本`))
        else assert.match(mounted.text(), /不代表长期估值水平/)
      }
    } finally { mounted.app.unmount() }
  }
  const initial = await mount('ValuationCoverage', { stats: valuationStats([]), loading: true })
  assert.match(initial.text(), /正在读取积累进度/)
  assert.ok(!initial.text().includes('暂无可用历史'))
  initial.app.unmount()
  const retained = await mount('ValuationCoverage', { stats: valuationStats(history.slice(0, 5)), error: '读取失败，保留上次数据' })
  assert.match(retained.text(), /2026-08-05/)
  assert.match(retained.text(), /保留上次数据/)
  retained.app.unmount()
})

test('homepage loads separate source coverage, keeps Eastmoney ranks unavailable and preserves CSI on failure', async () => {
  const previousFetch = globalThis.fetch
  let mounted, failCsi = false
  const payloads = Object.fromEntries(await Promise.all(['valuation-history-h30269', 'valuation-history-csi-h30269', 'valuation-csi-status-h30269'].map(async name => [name, JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))])))
  // Fix the sparse-history scenario even as the repository accumulates new data.
  payloads['valuation-history-h30269'].history = history.slice(0, 5)
  payloads['valuation-history-h30269'].date = history[4].date
  const csiExample = payloads['valuation-history-csi-h30269'].history[0]
  payloads['valuation-history-csi-h30269'].history = history.slice(0, 20).map(point => ({ ...csiExample, date: point.date }))
  payloads['valuation-history-csi-h30269'].date = history[19].date
  try {
    globalThis.fetch = async url => {
      const name = url.split('/').at(-1).split('.json')[0]
      if (failCsi && name === 'valuation-history-csi-h30269') throw new Error('中证历史读取失败')
      return Response.json(payloads[name])
    }
    mounted = await mount('ValuationAnalysis', { summary: true, instrument: '512890' })
    await flush()
    assert.match(mounted.text(), /东方财富 · PE \/ PB/)
    assert.match(mounted.text(), /中证 · PE（总股本）/)
    assert.match(mounted.text(), /不拼接样本/)
    const counts = () => mounted.nodes().filter(n => n.tag === 'progress').map(n => n.props.value)
    assert.deepEqual(counts(), [Math.min(20, payloads['valuation-history-h30269'].history.length), Math.min(20, payloads['valuation-history-csi-h30269'].history.length)])
    assert.match(mounted.text(), /样本积累中/)
    assert.equal(mounted.nodes().filter(n => n.props.role === 'meter').length, 0)
    failCsi = true
    await mounted.instance.refresh(); await flush()
    assert.match(mounted.text(), /中证历史读取失败，保留上次数据/)
    assert.equal(counts()[1], 20)
    assert.equal(mounted.instance.error, true)
  } finally { mounted?.app.unmount(); globalThis.fetch = previousFetch }
})
