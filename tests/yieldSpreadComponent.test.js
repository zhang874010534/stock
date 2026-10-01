import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { emptyYieldHistory, mergeYieldHistory, YIELD_SERIES } from '../src/utils/yieldSpread.js'
const NativeDate = Date, stamp = '2026-10-01T08:00:00Z'
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
const snapshot = (kind, date, value) => ({ ...YIELD_SERIES[kind], date, value, unit: 'percent' })
function history() {
  return mergeYieldHistory(emptyYieldHistory(), { dividend: snapshot('dividend', '2026-09-28', 4), treasury: snapshot('treasury', '2026-09-28', 2) })
}
async function mount(dashboard) {
  const previous = { Date: globalThis.Date, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot }
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [stamp])) } }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL('../src/components/YieldSpreadAnalysis.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'yield-spread-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const YieldSpreadCharts = defineAsyncComponent\(\(\) => import\([^\n]+/, "const YieldSpreadCharts = { props: ['analysis'], setup(props) { return () => testH('div', { spreadAnalysis: props.analysis }) } }")
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}) })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const host = node('host'), props = reactive({ instrument: '512890' })
  const app = renderer.createApp({ setup() { provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), analysis: () => all(host).find(n => n.props.spreadAnalysis)?.props.spreadAnalysis,
    field: label => all(host).find(n => n.props['aria-label'] === label), button: text => all(host).find(n => n.tag === 'button' && n.text === text),
    close() { app.unmount(); Object.assign(globalThis, previous) } }
}
function loaders(extra = {}) { return { dividend: () => snapshot('dividend', '2026-09-30', 4.39), treasury: () => snapshot('treasury', '2026-09-30', 1.6822), yieldHistory: history, collection: () => ({ sources: {} }), ...extra } }

test('summary uses all pairs; filters update charts/table/statistics and instrument labels stay explicit', async () => {
  const view = await mount(createDashboardData(loaders()))
  try {
    await flush(); assert.equal(view.analysis().count, 2); assert.match(view.text(), /\+2.7078 个百分点/); assert.match(view.text(), /\+0.7078 个百分点/)
    assert.match(view.text(), /ETF 标的指数 H30269/); assert.match(view.text(), /不代表 ETF 实际现金分红收益率/)
    view.field('差值开始日期').props['onUpdate:modelValue']('2026-09-30'); await nextTick(); assert.equal(view.analysis().count, 1)
    assert.match(view.text(), /\+0.7078 个百分点/)
    view.field('差值结束日期').props['onUpdate:modelValue']('2026-09-28'); await nextTick(); assert.match(view.text(), /开始日期不能晚于结束日期/); assert.equal(view.analysis(), undefined)
    view.button('全部记录').props.onClick(); await nextTick(); assert.equal(view.analysis().count, 2)
    view.props.instrument = 'H30269'; await nextTick(); assert.match(view.text(), /H30269 指数/); assert.equal(view.analysis().count, 2)
  } finally { view.close() }
})
test('partial refresh failure preserves the full committed group and dates until successful recovery', async () => {
  let version = 1, fail = false
  const dashboard = createDashboardData(loaders({ dividend: () => snapshot('dividend', '2026-09-30', version === 1 ? 4.39 : 5), treasury: () => { if (fail) throw new Error('offline'); return snapshot('treasury', '2026-09-30', 1.6822) } }))
  const view = await mount(dashboard)
  try {
    await flush(); const original = view.analysis()
    version = 2; fail = true; await dashboard.refresh(['dividend']); await flush()
    assert.equal(view.analysis(), original); assert.match(view.text(), /保留整组上次数据与原日期/); assert.match(view.text(), /\+2.7078/)
    fail = false; await dashboard.refresh(['yieldHistory']); await flush(); assert.notEqual(view.analysis(), original); assert.match(view.text(), /\+3.3178/)
    dashboard.states.collection.data = { sources: { bond: { status: 'error' } } }; await nextTick(); assert.match(view.text(), /后台更新失败/)
  } finally { view.close() }
})
test('mismatched latest dates retain the last same-day result; missing files and unpaired-only history never show zero spread', async () => {
  let view = await mount(createDashboardData(loaders({ treasury: () => snapshot('treasury', '2026-09-29', 1.7) })))
  try { await flush(); assert.match(view.text(), /最新两项日期不一致，不相减/); assert.match(view.text(), /\+2.0000/); assert.equal(view.analysis().unpairedCount, 2) } finally { view.close() }
  view = await mount(createDashboardData(loaders({ yieldHistory: () => { throw new Error('404') } })))
  try { await flush(); assert.equal(view.analysis(), undefined); assert.match(view.text(), /暂无可计算数据/); assert.ok(!view.text().includes('0.0000 个百分点')) } finally { view.close() }
  view = await mount(createDashboardData(loaders({ yieldHistory: emptyYieldHistory, treasury: () => snapshot('treasury', '2026-09-29', 1.7) })))
  try { await flush(); assert.equal(view.analysis().count, 0); assert.match(view.text(), /暂无同日样本/); assert.ok(!view.text().includes('0.0000 个百分点')) } finally { view.close() }
})
test('refreshing calculated metrics also refreshes the used yield group without duplicate requests', async () => {
  const calls = {}
  const dashboard = createDashboardData(Object.fromEntries(['latestMetrics', 'valuation', 'dividend', 'treasury', 'yieldHistory'].map(key => [key, () => { calls[key] = (calls[key] ?? 0) + 1; return {} }])))
  for (const key of ['latestMetrics', 'valuation', 'dividend', 'treasury', 'yieldHistory']) await dashboard.ensure(key)
  await dashboard.refresh(['latestMetrics'])
  assert.ok(Object.values(calls).every(count => count === 2))
})
