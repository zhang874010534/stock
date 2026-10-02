import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { calculateEtfLiquidity } from '../src/utils/etfLiquidity.js'

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
async function mount(name, initial, dashboard, chart, download) {
  const previousDocument = globalThis.Document, previousShadow = globalThis.ShadowRoot
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'liquidity-component-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const EtfLiquidityTrend = defineAsyncComponent\(\(\) => import\([^\n]+/, "const EtfLiquidityTrend = { props: ['stats', 'kind', 'selection'], setup(props) { return () => testH('div', { chartStats: props.stats, chartKind: props.kind, chartSelection: props.selection }) } }")
    .replace(/import \{ initEtfReturn as initTrend \} from ['"][^'"]+['"]/, 'const initTrend = element => element.chart')
    .replace(/import \{ downloadBlob \} from ['"][^'"]+['"]/, 'const downloadBlob = (...args) => globalThis.liquidityDownload(...args)')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  if (download) globalThis.liquidityDownload = download
  const node = tag => ({ tag, children: [], props: {}, text: '', clientWidth: 600, clientHeight: 450, chart, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}) })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), props = reactive(initial)
  const app = renderer.createApp({ setup() { if (dashboard) provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, unmount: () => { app.unmount(); globalThis.Document = previousDocument; globalThis.ShadowRoot = previousShadow }, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' ') }
}
async function snapshots() {
  const read = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
  const [market, size, fees] = await Promise.all(['512890', 'size-512890', 'fees-512890'].map(read))
  return { '512890': market, etfSize: size, etfFees: fees, collection: { schemaVersion: 1, sources: {} } }
}
const click = async (view, label) => { const button = view.nodes().find(n => n.tag === 'button' && n.text === label); if (button.props.type === 'submit') button.parent.props.onSubmit({ preventDefault() {} }); else button.props.onClick(); await nextTick() }
const set = (view, label, value) => view.nodes().find(n => n.props['aria-label'] === label).props['onUpdate:modelValue'](value)
const form = (view, label) => view.nodes().find(n => n.tag === 'form' && n.props['aria-label'] === label)

test('规模与费率保留各自日期，真实成交单位、成本条件、自定义区间与 CSV 空值正确', async () => {
  const data = await snapshots(), dashboard = createDashboardData(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, async () => value])))
  let blob, filename
  const view = await mount('EtfLiquidityAnalysis', {}, dashboard, null, (value, name) => { blob = value; filename = name })
  try {
    await flush()
    assert.match(view.text(), /312.90 亿元/); assert.match(view.text(), /报告期 2026-06-30/); assert.match(view.text(), /披露资料 2026-03-18/)
    assert.match(view.text(), /0.50%/); assert.match(view.text(), /0.10%/); assert.match(view.text(), /9.90 亿元/); assert.match(view.text(), /3.22%/)
    assert.match(view.text(), /买卖价差：未接入盘口数据/)
    await click(view, '计算成本情景'); assert.match(view.text(), /请填写自己的佣金/)
    set(view, '成本佣金万分比', '1'); set(view, '成本最低佣金', '5'); await nextTick(); await click(view, '计算成本情景')
    assert.match(view.text(), /单笔佣金 5.00 元/); assert.match(view.text(), /两笔等额买卖佣金 10.00 元/); assert.match(view.text(), /费用参考 60.00 元/)
    assert.match(view.text(), /0.0015%/)
    await click(view, '自定义')
    assert.ok(view.nodes().find(n => n.props['aria-label'] === '流动性开始日期').value)
    set(view, '流动性开始日期', '2026-09-30'); set(view, '流动性结束日期', '2026-09-28'); await nextTick()
    form(view, '自定义流动性区间').props.onSubmit({ preventDefault() {} }); await nextTick(); assert.match(view.text(), /开始日期不能晚于/)
    set(view, '流动性开始日期', '2026-09-28'); set(view, '流动性结束日期', '2026-09-30'); await nextTick()
    form(view, '自定义流动性区间').props.onSubmit({ preventDefault() {} }); await nextTick()
    const missing = structuredClone(data['512890']); delete missing.history.at(-2).amount; dashboard.states['512890'].data = missing; await nextTick()
    assert.match(view.text(), /缺成交额 1 日/)
    await click(view, '导出流动性 CSV'); assert.match(filename, /512890_流动性_2026-09-28_2026-09-30.csv/)
    assert.match(await blob.text(), /2026-09-29,,,[0-9.]+,/)
  } finally { view.unmount(); delete globalThis.liquidityDownload }
})
test('规模读取失败保留原报告期，独立成交观察仍更新；首次费用失败不出现假费率', async () => {
  const data = await snapshots(); let failed = '', next = false
  const dashboard = createDashboardData(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, async () => {
    if (failed === key) throw new Error('offline')
    if (next && key === '512890') { const copy = structuredClone(value); copy.history.at(-1).amount *= 2; copy.latest = copy.history.at(-1); return copy }
    return value
  }])))
  const view = await mount('EtfLiquidityAnalysis', {}, dashboard)
  try {
    await flush(); failed = 'etfSize'; next = true; await dashboard.refresh(['512890', 'etfSize']); await flush()
    assert.match(view.text(), /规模：offline/); assert.match(view.text(), /312.90 亿元/); assert.match(view.text(), /19.80 亿元/)
    dashboard.states.etfSize.data = { ...data.etfSize, status: 'stale', reason: 'provider failure' }; await nextTick()
    assert.match(view.text(), /更新失败，保留原报告期/); assert.match(view.text(), /provider failure/)
  } finally { view.unmount() }
  const unavailable = createDashboardData(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, async () => { if (key === 'etfFees') throw new Error('offline'); return value }])))
  const empty = await mount('EtfLiquidityAnalysis', {}, unavailable)
  try { await flush(); assert.match(empty.text(), /费率：offline/); assert.ok(!empty.text().includes('0.50%')); await click(empty, '计算成本情景'); assert.match(empty.text(), /费率不可用/) }
  finally { empty.unmount() }
})
test('复用 ETF 行情并合并并发请求，规模与费率不依赖其他数据失败', async () => {
  const data = await snapshots(), calls = {}
  const dashboard = createDashboardData(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, async () => { calls[key] = (calls[key] ?? 0) + 1; return value }])))
  await dashboard.ensure('512890')
  const view = await mount('EtfLiquidityAnalysis', {}, dashboard)
  try {
    await flush(); assert.equal(calls['512890'], 1); assert.equal(calls.etfSize, 1); assert.equal(calls.etfFees, 1)
    await Promise.all([dashboard.refresh(['etfSize']), dashboard.refresh(['etfSize'])]); assert.equal(calls.etfSize, 2)
  } finally { view.unmount() }
})
test('折叠和隐藏时图表延迟更新，显示恢复缩放，切换区间重置并释放实例', async () => {
  const data = await snapshots(), stats = calculateEtfLiquidity(data['512890'])
  const previous = globalThis.ResizeObserver; let notify, disposed = false, disconnected = false, option
  const options = [], chart = { getOption: () => option, setOption(value) { option = value; options.push(value) }, resize() {}, dispose() { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  let view
  try {
    view = await mount('EtfLiquidityTrend', { stats, selection: 'year' }, null, chart)
    assert.equal(options.length, 1); option = { dataZoom: [{ start: 50, end: 100 }] }
    const canvas = view.nodes().find(n => n.props.class?.includes('liquidity-trend')); canvas.clientWidth = 0
    view.props.stats = { ...stats, points: stats.points.slice(1) }; await nextTick(); assert.equal(options.length, 1)
    canvas.clientWidth = 600; notify(); assert.equal(options.length, 2); assert.equal(options.at(-1).dataZoom[0].start, 50); assert.equal(options.at(-1).dataZoom[1].start, 50)
    view.props.selection = '30d'; await nextTick(); assert.equal(options.at(-1).dataZoom[0].start, undefined)
  } finally { view?.unmount(); globalThis.ResizeObserver = previous }
  notify(); assert.equal(disposed, true); assert.equal(disconnected, true)
})
