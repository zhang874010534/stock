import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { calculateEtfPremium } from '../src/utils/etfNavAnalysis.js'

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
async function mount(name, initial, dashboard, chart, download) {
  const previousDocument = globalThis.Document, previousShadow = globalThis.ShadowRoot
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'nav-component-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const EtfNavTrend = defineAsyncComponent\(\(\) => import\([^\n]+/, "const EtfNavTrend = { props: ['stats', 'kind', 'selection'], setup(props) { return () => testH('div', { chartStats: props.stats, chartKind: props.kind, chartSelection: props.selection }) } }")
    .replace(/import \{ initEtfReturn as initTrend \} from ['"][^'"]+['"]/, 'const initTrend = element => element.chart')
    .replace(/import \{ downloadBlob \} from ['"][^'"]+['"]/, 'const downloadBlob = (...args) => globalThis.navDownload(...args)')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  if (download) globalThis.navDownload = download
  const node = tag => ({ tag, children: [], props: {}, text: '', clientWidth: 600, clientHeight: 300, chart, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}) })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), props = reactive(initial)
  const app = renderer.createApp({ setup() { if (dashboard) provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, unmount: () => { app.unmount(); globalThis.Document = previousDocument; globalThis.ShadowRoot = previousShadow }, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' ') }
}
const read = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
const snapshots = async () => {
  const [market, nav, index, events] = await Promise.all(['512890', 'nav-512890', 'h30269', 'distributions-512890'].map(read))
  return { '512890': market, etfNav: nav, H30269: index, etfDistributions: events, collection: { schemaVersion: 1, sources: {} } }
}
const click = async (view, text) => { view.nodes().find(n => n.tag === 'button' && n.text === text).props.onClick(); await nextTick() }

test('NAV view displays actual dates and methodology; invalid custom range clears charts, CSV preserves null samples', async () => {
  const data = await snapshots(), dashboard = createDashboardData(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, async () => value])))
  let blob, filename
  const view = await mount('EtfNavAnalysis', {}, dashboard, null, (value, name) => { blob = value; filename = name })
  try {
    await flush()
    assert.equal(view.nodes().filter(n => n.props.chartStats).length, 3)
    assert.match(view.text(), /不等同于基金合同的全收益口径/)
    assert.match(view.text(), /2026-09-30/)
    await click(view, '自定义')
    assert.equal(view.nodes().filter(n => n.props.chartStats).length, 0)
    const setDate = (name, value) => view.nodes().find(n => n.props['aria-label'] === name).props['onUpdate:modelValue'](value)
    setDate('净值开始日期', '2026-09-30'); setDate('净值结束日期', '2026-09-28'); await nextTick()
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await nextTick()
    assert.match(view.text(), /开始日期不能晚于结束日期/)
    assert.equal(view.nodes().filter(n => n.props.chartStats).length, 0)
    setDate('净值开始日期', '2026-09-28'); setDate('净值结束日期', '2026-09-30'); await nextTick()
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await nextTick()
    assert.equal(view.nodes().filter(n => n.props.chartStats).length, 3)
    const missing = structuredClone(data.etfNav); missing.history = missing.history.filter(row => row.date !== '2026-09-29')
    dashboard.states.etfNav.data = missing; await nextTick()
    assert.match(view.text(), /缺少 1 个同日样本/)
    assert.match(view.text(), /ETF 净值 缺少 1 个交易日/)
    assert.equal(view.nodes().filter(n => n.props.chartStats).length, 2)
    await click(view, '导出折溢价 CSV')
    assert.match(filename, /512890_折溢价_2026-09-28_2026-09-30.csv/)
    const csv = await blob.text()
    assert.match(csv, /2026-09-29,[0-9.]+,,\r?\n/)
    assert.match(view.text(), /CSV 已生成/)
  } finally { view.unmount(); delete globalThis.navDownload }
})

test('NAV view retains each complete input group on read failure; successful premium refresh proceeds despite index failure', async () => {
  const data = await snapshots(); let fail = '', next = false
  const dashboard = createDashboardData(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, async () => {
    if (fail === key) throw new Error('offline')
    if (next && key === 'etfNav') return { ...value, history: value.history.map(row => row.date === value.date ? { ...row, nav: row.nav * 1.01 } : row) }
    return value
  }])))
  const view = await mount('EtfNavAnalysis', {}, dashboard)
  try {
    await flush()
    const previous = Object.fromEntries(view.nodes().filter(n => n.props.chartStats).map(n => [n.props.chartKind, n.props.chartStats]))
    next = true; fail = 'H30269'
    await dashboard.refresh(['etfNav']); await flush()
    assert.match(view.text(), /标的指数：offline/)
    const updated = Object.fromEntries(view.nodes().filter(n => n.props.chartStats).map(n => [n.props.chartKind, n.props.chartStats]))
    assert.notEqual(updated.premium.current.premium, previous.premium.current.premium)
    assert.deepEqual(updated.tracking, previous.tracking)
    fail = 'etfNav'; await dashboard.refresh(['etfNav']); await flush()
    assert.match(view.text(), /净值：offline/)
    assert.deepEqual(view.nodes().find(n => n.props.chartKind === 'premium').props.chartStats, updated.premium)
    fail = ''; await dashboard.refresh(['etfNav']); await flush()
    assert.ok(!view.text().includes('文件读取失败'))
    dashboard.states.etfNav.data = { ...data.etfNav, status: 'stale', reason: 'provider offline', lastAttemptAt: new Date().toISOString() }; await nextTick()
    assert.match(view.text(), /净值更新失败，保留原数据/); assert.match(view.text(), /provider offline/)
  } finally { view.unmount() }
})

test('first NAV read failure never displays fabricated zero premium or tracking', async () => {
  const data = await snapshots()
  const dashboard = createDashboardData(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, async () => { if (key === 'etfNav') throw new Error('offline'); return value }])))
  const view = await mount('EtfNavAnalysis', {}, dashboard)
  try { await flush(); assert.match(view.text(), /尚无完整输入/); assert.ok(!view.nodes().some(n => n.props.chartStats)); assert.ok(!view.text().includes('0.00%')) }
  finally { view.unmount() }
})

test('used NAV sources refresh together and concurrent calls coalesce', async () => {
  const keys = ['512890', 'H30269', '000300', 'etfNav', 'etfDistributions'], calls = {}
  const dashboard = createDashboardData(Object.fromEntries(keys.map(key => [key, async () => { calls[key] = (calls[key] ?? 0) + 1; return {} }])))
  await Promise.all(keys.map(dashboard.ensure))
  await Promise.all([dashboard.refresh(['512890']), dashboard.refresh(['etfNav'])])
  assert.ok(keys.every(key => calls[key] === 2))
})

test('NAV chart defers hidden updates, preserves zoom on refresh, resets after interval change and disposes', async () => {
  const data = await snapshots(), stats = calculateEtfPremium(data['512890'], data.etfNav, { range: '30d' })
  const previousObserver = globalThis.ResizeObserver
  let notify, disposed = false, disconnected = false, option
  const options = [], chart = { getOption: () => option, setOption(value) { option = value; options.push(value) }, resize() {}, dispose() { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  let view
  try {
    view = await mount('EtfNavTrend', { stats, kind: 'premium', selection: '30d' }, null, chart)
    assert.equal(options.length, 1); option = { dataZoom: [{ start: 50, end: 100 }] }
    const canvas = view.nodes().find(n => n.props.class === 'nav-trend'); canvas.clientWidth = 0
    view.props.stats = { ...stats, points: stats.points.slice(1) }; await nextTick(); assert.equal(options.length, 1)
    canvas.clientWidth = 600; notify(); assert.equal(options.length, 2); assert.equal(options.at(-1).dataZoom[0].start, 50)
    view.props.selection = 'custom'; await nextTick(); assert.equal(options.length, 3); assert.equal(options.at(-1).dataZoom[0].start, undefined)
  } finally { view?.unmount(); globalThis.ResizeObserver = previousObserver }
  notify(); assert.equal(disposed, true); assert.equal(disconnected, true); assert.equal(options.length, 3)
})
