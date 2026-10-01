import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { ALERTS_KEY } from '../src/utils/observationAlerts.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'

const NativeDate = Date
const memoryStorage = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } }
async function mount(dashboard, storage = memoryStorage()) {
  const previous = { Date: globalThis.Date, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot, localStorage: globalThis.localStorage }
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-10-01T08:00:00.000Z'])) } static now() { return NativeDate.parse('2026-10-01T08:00:00.000Z') } }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}; globalThis.localStorage = storage
  const file = new URL('../src/components/ObservationAlerts.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'alerts-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}), get options() { return this.children.filter(n => n.tag === 'option') } })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const host = node('host'), props = reactive({ instrument: '512890' })
  const app = renderer.createApp({ setup() { provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), button: label => all(host).find(n => n.tag === 'button' && n.text === label),
    field: label => all(host).find(n => n.props['aria-label'] === label),
    unmount() { app.unmount(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } }, storage }
}
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
function market(code, price = code === '512890' ? 1.1 : 100) {
  const history = [1.2 * price, price].map((close, i) => ({ date: ['2026-09-29', '2026-09-30'][i], open: close, close, high: close, low: close }))
  return { code, source: 'eastmoney', interval: '1d', updatedAt: '2026-09-30T10:00:00Z', backfill: { completed: false }, latest: history.at(-1), history }
}
function loaders() {
  return { '512890': () => market('512890'), H30269: () => market('H30269'),
    valuation: () => ({ code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE, basis: 'provider_unspecified', unit: 'multiple', date: '2026-09-30', pe: 8, pb: .8 }),
    collection: () => ({ sources: { H30269: { status: 'ok' }, '512890': { status: 'ok' }, valuation: { status: 'ok' } } }) }
}
async function saveRule(view, metric = 'price', threshold = '1.2') {
  view.button('添加条件').props.onClick(); await nextTick()
  view.field('观察指标').props['onUpdate:modelValue'](metric)
  view.field('观察阈值').props['onUpdate:modelValue'](threshold)
  view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await flush()
}

test('页面可新增编辑暂停删除撤销，阈值满足后留记录，重新打开不重复触发', async () => {
  const storage = memoryStorage(), dashboard = createDashboardData(loaders())
  let view = await mount(dashboard, storage)
  try {
    await flush(); assert.match(view.text(), /尚未设置观察条件/)
    await saveRule(view)
    assert.match(view.text(), /ETF 收盘价格 ≤ 1.2 元/); assert.match(view.text(), /1 条满足/)
    assert.match(view.text(), /数据日期 2026-09-30/)
    assert.equal(JSON.parse(storage.getItem(ALERTS_KEY)).events.length, 1)
    view.button('暂停').props.onClick(); await flush(); assert.match(view.text(), /已暂停/)
    view.button('启用').props.onClick(); await flush()
    assert.equal(JSON.parse(storage.getItem(ALERTS_KEY)).events.length, 1)
    view.button('编辑').props.onClick(); await nextTick()
    view.field('观察阈值').props['onUpdate:modelValue']('1')
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await flush()
    assert.match(view.text(), /未满足/); assert.match(view.text(), /ETF 收盘价格 ≤ 1.2 元/)
    view.button('删除').props.onClick(); await flush(); assert.match(view.text(), /已删除一条条件/)
    view.button('撤销删除').props.onClick(); await flush(); assert.match(view.text(), /ETF 收盘价格 ≤ 1 元/)
    view.button('全部标为已读').props.onClick(); await flush(); assert.match(view.text(), /0 条未读/)
    view.unmount(); view = await mount(createDashboardData(loaders()), storage); await flush()
    assert.equal(JSON.parse(storage.getItem(ALERTS_KEY)).events.length, 1)
    assert.match(view.text(), /ETF 收盘价格 ≤ 1 元/)
  } finally { view.unmount() }
})

test('证券切换隔离规则和历史，ETF的PE/PB标为标的指数，空阈值与重复条件给出原因', async () => {
  const view = await mount(createDashboardData(loaders()))
  try {
    await flush(); await saveRule(view, 'pe', '9')
    assert.match(view.text(), /标的指数 PE ≤ 9 倍/)
    await saveRule(view, 'pe', '9'); assert.match(view.text(), /已有这条提醒条件/)
    view.props.instrument = 'H30269'; await flush()
    assert.match(view.text(), /尚未设置观察条件/); assert.ok(!view.text().includes('触发记录 ·'))
    await saveRule(view, 'drawdown', ''); assert.match(view.text(), /请填写观察阈值/)
    view.field('观察阈值').props['onUpdate:modelValue']('10')
    view.field('满足条件').props['onUpdate:modelValue']('gte')
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await flush()
    assert.match(view.text(), /当前回撤跌幅 ≥ 10 %/); assert.match(view.text(), /1 条满足/)
    view.props.instrument = '512890'; await flush()
    assert.match(view.text(), /标的指数 PE ≤ 9 倍/); assert.ok(!view.text().includes('当前回撤跌幅 ≥ 10 %'))
  } finally { view.unmount() }
})

test('刷新失败转为待核验且保留触发历史，不把失败当作条件解除', async () => {
  let fail = false, price = 1.1
  const dashboard = createDashboardData({ ...loaders(), '512890': () => { if (fail) throw new Error('offline'); return market('512890', price) } })
  const view = await mount(dashboard)
  try {
    await flush(); await saveRule(view)
    fail = true; await dashboard.refresh(['512890']); await flush()
    assert.match(view.text(), /待核验/); assert.match(view.text(), /文件读取失败/)
    assert.match(view.text(), /触发值 1.1 元/)
    fail = false; await dashboard.refresh(['512890']); await flush()
    assert.equal(JSON.parse(view.storage.getItem(ALERTS_KEY)).events.length, 1)
    price = 1.3; await dashboard.refresh(['512890']); await flush(); assert.match(view.text(), /未满足/)
    price = 1.1; await dashboard.refresh(['512890']); await flush()
    assert.equal(JSON.parse(view.storage.getItem(ALERTS_KEY)).events.length, 2)
  } finally { view.unmount() }
})

test('浏览器禁止保存时仍能创建与检查，并明确提示当前修改无法保留', async () => {
  const view = await mount(createDashboardData(loaders()), { getItem() { return null }, setItem() { throw new Error('denied') } })
  try { await flush(); await saveRule(view); assert.match(view.text(), /保存失败/); assert.match(view.text(), /1 条满足/) }
  finally { view.unmount() }
})
