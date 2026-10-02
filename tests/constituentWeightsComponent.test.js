import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
async function mount(name, initial, dashboard) {
  const previousDocument = globalThis.Document, previousShadow = globalThis.ShadowRoot
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'structure-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}), get options() { return this.children.filter(n => n.tag === 'option') } })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const host = node('host'), props = reactive(initial)
  const app = renderer.createApp({ setup() { provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, unmount: () => { app.unmount(); globalThis.Document = previousDocument; globalThis.ShadowRoot = previousShadow }, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), button: label => all(host).find(n => n.tag === 'button' && n.text === label) }
}
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
const index = JSON.parse(await readFile(new URL('../public/data/weights-h30269.json', import.meta.url), 'utf8'))
const etf = JSON.parse(await readFile(new URL('../public/data/holdings-512890.json', import.meta.url), 'utf8'))
const history = JSON.parse(await readFile(new URL('../public/data/constituents-history-h30269.json', import.meta.url), 'utf8'))
test('weighted analysis renders real totals, reference dates, ETF active-only filtering and search', async () => {
  const view = await mount('ConstituentWeights', { classification: history.snapshots.at(-1) }, createDashboardData({ constituentWeights: () => index, etfHoldings: () => etf }))
  try {
    await flush()
    assert.match(view.text(), /25.44%/); assert.match(view.text(), /25.02%/)
    assert.match(view.text(), /日期不同/); assert.match(view.text(), /不能据此判断跟踪偏离/)
    assert.match(view.text(), /完整股票 74 只/); assert.match(view.text(), /并非权重日的历史分类/)
    const field = label => view.nodes().find(row => row.props['aria-label'] === label)
    field('权重分析组合').props['onUpdate:modelValue']('etf'); await nextTick()
    assert.match(view.text(), /ETF 前十大股票/)
    field('筛选持仓名单关系').props['onUpdate:modelValue']('etf'); await nextTick()
    assert.match(view.text(), /24 \/ 74 只/)
    field('搜索权重对照股票').props['onUpdate:modelValue']('001248'); await nextTick()
    assert.match(view.text(), /1 \/ 74 只/); assert.match(view.text(), /华润新能源/); assert.match(view.text(), /<0.01%/)
    view.button('清除筛选').props.onClick(); await nextTick()
    field('筛选权重行业金融').props.onClick(); await nextTick()
    assert.match(view.text(), /· 金融/)
    view.props.classification = null; await nextTick()
    assert.match(view.text(), /行业来源日期 暂无/); assert.match(view.text(), /未分类/)
  } finally { view.unmount() }
})
test('refresh failure or a pending side retains the entire pair; successful retry replaces both', async () => {
  let version = 1, fail = false, release
  const nextIndex = { ...index, date: '2026-09-01' }, nextEtf = { ...etf, date: '2026-07-01' }
  const dashboard = createDashboardData({ constituentWeights: () => version === 1 ? index : nextIndex, etfHoldings: () => {
    if (fail) throw new Error('offline')
    return version === 1 ? etf : new Promise(done => { release = () => done(nextEtf) })
  } })
  const view = await mount('ConstituentWeights', {}, dashboard)
  try {
    await flush(); version = 2; fail = true
    await dashboard.refresh(['constituentWeights']); await flush()
    assert.match(view.text(), /保留上次整组权重对照及原日期/); assert.ok(!view.text().includes('2026-09-01'))
    fail = false
    const refresh = dashboard.refresh(['etfHoldings']); await flush()
    assert.ok(!view.text().includes('2026-09-01'))
    release(); await refresh; await flush()
    assert.match(view.text(), /2026-09-01/); assert.match(view.text(), /2026-07-01/)
  } finally { view.unmount() }
})
test('first missing ETF input is not treated as zero; stale collector status remains visible', async () => {
  const view = await mount('ConstituentWeights', {}, createDashboardData({ constituentWeights: () => ({ ...index, status: 'stale', reason: '保留原权重' }), etfHoldings: () => { throw new Error('missing report') } }))
  try {
    await flush(); assert.match(view.text(), /25.44%/); assert.match(view.text(), /保留原权重/)
    assert.match(view.text(), /缺失的来源不视为零持仓/); assert.ok(!view.text().includes('仅 ETF 0 只'))
    assert.equal(view.button('导出筛选对照 CSV').props.disabled, true)
  } finally { view.unmount() }
})
test('CSV contains the filtered exact small position, source dates and collection status', async () => {
  const originalDocument = globalThis.document, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  let blob, clicked = false
  globalThis.document = { body: { append() {} }, createElement: () => ({ click() { clicked = true }, remove() {} }) }
  URL.createObjectURL = value => { blob = value; return 'blob:test' }; URL.revokeObjectURL = () => {}
  const view = await mount('ConstituentWeights', { classification: history.snapshots.at(-1) }, createDashboardData({ constituentWeights: () => index, etfHoldings: () => etf }))
  try {
    await flush()
    view.nodes().find(node => node.props['aria-label'] === '搜索权重对照股票').props['onUpdate:modelValue']('001248'); await nextTick()
    view.button('导出筛选对照 CSV').props.onClick()
    assert.equal(clicked, true)
    const csv = await blob.text(), row = csv.split('\r\n').at(-1)
    assert.match(csv, /2026-08-31/); assert.match(csv, /2026-06-30/); assert.match(csv, /2026-08-29/)
    assert.match(csv, /跨日差异不代表跟踪偏离/); assert.match(csv, /指数采集状态/)
    assert.match(row, /001248.*华润新能源/); assert.match(row, /850291.44/)
    assert.equal(csv.split('\r\n').length, 6); assert.ok(!csv.includes('三维化学'))
    assert.match(view.text(), /当前筛选的对照 CSV 已生成/)
  } finally { view.unmount(); globalThis.document = originalDocument; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke }
})
