import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { calculateHoldingPeriods } from '../src/utils/holdingPeriods.js'
import { tradingSessions } from '../src/utils/priceRisk.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'

const NativeDate = Date, stamp = '2026-10-01T08:00:00.000Z'
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
function market(code = '512890', multiplier = 1, start = '2023-03-01') {
  const history = tradingSessions(start, '2026-09-30', tradingCalendar).map((date, i) => {
    const close = multiplier * (10 + Math.sin(i / 30)); return { date, open: close, close, high: close, low: close }
  })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: stamp, backfill: { completed: false }, history, latest: history.at(-1) }
}
const distribution = () => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', coverage: { start: '2018-12-19', end: '2026-10-01' }, checkedAt: stamp, status: 'ok', reason: null, dividends: [], splits: [] })
function valuations() {
  const history = market().history.map((row, index) => ({ date: row.date, pe: 10 + 2 * Math.sin(index / 30), pb: 1 + .2 * Math.sin(index / 30) }))
  return { schemaVersion: 1, code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE, basis: 'provider_unspecified', unit: 'multiple', date: history.at(-1).date, history }
}
async function mount(dashboard, { chartSeries, chart } = {}) {
  const previous = { Date: globalThis.Date, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot }
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [stamp])) } }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL(`../src/components/${chartSeries ? 'HoldingPeriodCharts' : 'HoldingPeriodAnalysis'}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'holding-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const HoldingPeriodCharts = defineAsyncComponent\(\(\) => import\([^\n]+/, "const HoldingPeriodCharts = { props: ['series', 'code', 'basis'], setup(props) { return () => testH('div', { holdingSeries: props.series, holdingCode: props.code, holdingBasis: props.basis }) } }")
    .replace(/import \{ initHoldingPeriod \} from ['"][^'"]+['"]/, 'const initHoldingPeriod = element => element.chart')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', chart, clientWidth: 700, clientHeight: 570, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}), get options() { return this.children.filter(n => n.tag === 'option') } })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const host = node('host'), props = reactive(chartSeries ? { series: chartSeries, code: '512890', basis: 'cash' } : { instrument: '512890' })
  const app = renderer.createApp({ setup() { if (dashboard) provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), series: () => all(host).find(n => n.props.holdingSeries)?.props.holdingSeries,
    button: label => all(host).find(n => n.tag === 'button' && (n.text === label || n.props['aria-label'] === label)),
    field: label => all(host).find(n => n.props['aria-label'] === label),
    unmount() { app.unmount(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } } }
}
function loaders(extra = {}) { return { '512890': () => market(), H30269: () => market('H30269', 100), etfDistributions: distribution, eastmoneyHistory: valuations, collection: () => ({ sources: { '512890': { status: 'ok' }, H30269: { status: 'ok' }, valuation: { status: 'ok' } } }), ...extra } }
async function apply(view) {
  view.nodes().find(node => node.props['aria-label'] === '持有期买入环境条件').props.onSubmit({ preventDefault() {} })
  await flush()
}

test('条件须应用后才改变曲线，AND筛选与对比同步，倒置边界保留结果，清除恢复全部样本', async () => {
  const view = await mount(createDashboardData(loaders()))
  try {
    await flush(); const original = structuredClone(JSON.parse(JSON.stringify(view.series())))
    view.field('回撤跌幅下限').props['onUpdate:modelValue']('10'); await nextTick()
    assert.equal(view.series().count, original.count); assert.match(view.text(), /条件已修改，点击应用/)
    await apply(view); const count = view.series().count
    assert.ok(count > 0 && count < original.count); assert.match(view.series().conditionLabel, /回撤跌幅 ≥ 10/)
    assert.equal(view.series().points.length, original.points.length)
    assert.match(view.text(), /条件齐全但不符合/); assert.match(view.text(), /因所选条件缺失未参加/)
    assert.match(view.text(), /只展示符合当前条件/)
    view.field('60 日年化波动率上限').props['onUpdate:modelValue']('8'); await apply(view)
    assert.ok(view.series().count > 0 && view.series().count <= count)
    const applied = view.series()
    view.field('回撤跌幅上限').props['onUpdate:modelValue']('5'); await apply(view)
    assert.match(view.text(), /下限不能大于上限/); assert.equal(view.series(), applied)
    view.button('清除条件').props.onClick(); await flush()
    assert.equal(view.series().count, original.count); assert.equal(view.series().mean, original.mean)
    assert.match(view.text(), /当前条件：不限制买入环境/)
  } finally { view.unmount() }
})

test('快捷条件、期限与口径切换、无匹配提示、买入日查询及证券切换均保持正确的条件范围', async () => {
  const view = await mount(createDashboardData(loaders()))
  try {
    await flush(); view.button('回撤至少 10%').props.onClick(); await flush()
    const rejected = view.series().points.find(point => point.status === 'excluded')
    view.field('查看持有期买入日').props['onUpdate:modelValue'](rejected.buyDate); await nextTick()
    assert.match(view.text(), /条件齐全，但不符合当前条件/); assert.match(view.text(), /以下收益仅供查询/)
    assert.match(view.text(), /买入环境参考日/); assert.match(view.text(), /累计收益/)
    view.button('持有 3 年').props.onClick(); await flush()
    assert.equal(view.series().years, 3); assert.match(view.series().conditionLabel, /回撤跌幅/)
    view.field('持有期收益口径').props['onUpdate:modelValue']('price'); await flush()
    assert.match(view.series().conditionLabel, /回撤跌幅/)
    view.field('回撤跌幅下限').props['onUpdate:modelValue']('100'); await apply(view)
    assert.equal(view.series(), undefined); assert.match(view.text(), /没有符合当前条件的 3 年完整样本/)
    assert.ok(!view.text().includes('NaN'))
    view.button('波动率不高于 15%').props.onClick(); await flush()
    assert.ok(view.series().count > 0); assert.match(view.series().conditionLabel, /波动率 ≤ 15/)
    view.props.instrument = 'H30269'; await flush()
    assert.equal(view.series().years, 1); assert.equal(view.series().conditionLabel, '')
    assert.match(view.text(), /当前条件：不限制买入环境/); assert.equal(view.field('回撤跌幅下限').value, '')
  } finally { view.unmount() }
})

test('同日PE与PB筛选读取独立估值观察，缺失覆盖不能冒充不符合或零收益，价格条件仍可用', async () => {
  const sparse = valuations(); sparse.history = sparse.history.filter(row => row.date >= '2026-09-01')
  const view = await mount(createDashboardData(loaders({ eastmoneyHistory: () => sparse })))
  try {
    await flush(); const total = view.series().count
    view.field('东方财富指数 PE上限').props['onUpdate:modelValue']('10'); await apply(view)
    assert.equal(view.series(), undefined); assert.match(view.text(), /缺少所选条件数据/)
    assert.match(view.text(), new RegExp(`0 个符合条件，0 个条件齐全但不符合，${total} 个因所选条件缺失`))
    view.field('查看持有期买入日').props['onUpdate:modelValue']('2023-06-01'); await nextTick()
    assert.match(view.text(), /所选条件缺失，无法归组/); assert.match(view.text(), /不沿用更早观察或后来估值/)
    view.button('回撤至少 10%').props.onClick(); await flush()
    assert.ok(view.series().count > 0); assert.ok(!view.series().conditionLabel.includes('PE'))
  } finally { view.unmount() }
})

test('估值初次失败与刷新失败保留来源状态，成功恢复后可筛选且请求复用，旧估值不回填缺日', async () => {
  let fail = true, calls = 0
  const dashboard = createDashboardData(loaders({ eastmoneyHistory: () => { calls++; if (fail) throw new Error('valuation offline'); return valuations() } }))
  const view = await mount(dashboard)
  try {
    await flush(); assert.ok(view.series().count > 0); assert.match(view.text(), /估值读取失败.*不可核验/)
    view.field('东方财富指数 PE上限').props['onUpdate:modelValue']('9'); view.field('东方财富指数 PB上限').props['onUpdate:modelValue']('.9'); await apply(view)
    assert.equal(view.series(), undefined)
    fail = false; await dashboard.refresh(['eastmoneyHistory']); await flush()
    assert.ok(view.series().count > 0); assert.match(view.series().conditionLabel, /PE ≤ 9.*PB ≤ 0.9/)
    const original = JSON.parse(JSON.stringify(view.series())), before = calls
    await Promise.all([dashboard.ensure('eastmoneyHistory'), dashboard.ensure('eastmoneyHistory')]); assert.equal(calls, before)
    fail = true; await dashboard.refresh(['eastmoneyHistory']); await flush()
    assert.deepEqual(JSON.parse(JSON.stringify(view.series())), original); assert.match(view.text(), /保留上次估值输入和原观察日期/)
    fail = false; await view.button('重新读取持有期数据').props.onClick(); await flush()
    assert.ok(!view.text().includes('valuation offline')); assert.ok(view.series().count > 0)
  } finally { view.unmount() }
})

test('one/three-year selection, extremes and exact buy-date inspection show raw complete periods or reasons', async () => {
  const view = await mount(createDashboardData(loaders()))
  try {
    await flush(); assert.equal(view.series().years, 1); assert.ok(view.series().count > 500)
    assert.match(view.text(), /不是未来获利概率/)
    view.button('查看最低收益窗口').props.onClick(); await nextTick()
    assert.equal(view.field('查看持有期买入日').value, view.series().worst.buyDate)
    assert.match(view.text(), /目标周年/); assert.match(view.text(), /实际持有/)
    view.button('持有 3 年').props.onClick(); await flush(); assert.equal(view.series().years, 3)
    assert.ok(view.series().count > 100)
    view.field('查看持有期买入日').props['onUpdate:modelValue']('2026-09-30'); await nextTick()
    assert.match(view.text(), /尚未完成持有 3 年/); assert.match(view.text(), /不显示短期替代收益/)
    view.field('查看持有期买入日').props['onUpdate:modelValue']('2023-03-04'); await nextTick()
    assert.match(view.text(), /该日不是交易日/)
    view.field('持有期收益口径').props['onUpdate:modelValue']('price'); await flush(); assert.match(view.text(), /ETF 价格收益，仅调整拆分/)
  } finally { view.unmount() }
})

test('one input failure preserves the pair, successful refresh replaces both, instrument switch clears ETF basis', async () => {
  let fail = false, multiplier = 1, calls = 0
  const dashboard = createDashboardData(loaders({ '512890': () => market('512890', multiplier), etfDistributions: () => { calls++; if (fail) throw new Error('offline'); return distribution() } }))
  const view = await mount(dashboard)
  try {
    await flush(); const original = JSON.parse(JSON.stringify(view.series()))
    multiplier = 2; fail = true; await dashboard.refresh(['512890', 'etfDistributions']); await flush()
    assert.match(view.text(), /保留上次整组行情与分红/); assert.deepEqual(view.series(), original)
    fail = false; await dashboard.refresh(['512890', 'etfDistributions']); await flush()
    assert.equal(view.series().windows[0].buyClose, original.windows[0].buyClose * 2)
    const before = calls; view.props.instrument = 'H30269'; await flush()
    assert.equal(calls, before); assert.match(view.text(), /指数价格收益，不能直接买入/)
    assert.equal(view.field('持有期收益口径'), undefined)
    assert.equal(view.nodes().find(n => n.props.holdingCode).props.holdingCode, 'H30269')
    assert.equal(view.nodes().find(n => n.props.holdingBasis).props.holdingBasis, 'price')
    view.props.instrument = '512890'; await flush(); assert.equal(view.nodes().find(n => n.props.holdingBasis).props.holdingBasis, 'cash')
  } finally { view.unmount() }
})

test('missing dividend input has no zero returns; short history has no fabricated three-year plot; gaps explain omissions', async () => {
  const dashboard = createDashboardData(loaders({ etfDistributions: () => { throw new Error('missing') }, H30269: () => market('H30269', 100, '2025-01-02') }))
  const view = await mount(dashboard)
  try {
    await flush(); assert.match(view.text(), /暂无完整分析输入/); assert.equal(view.series(), undefined)
    view.props.instrument = 'H30269'; await flush(); assert.ok(view.series())
    view.button('持有 3 年').props.onClick(); await flush(); assert.equal(view.series(), undefined)
    assert.match(view.text(), /暂无完整、可核验的 3 年/); assert.ok(!view.text().includes('（0 / 0）'))
    const missing = market('H30269'); missing.history = missing.history.filter(row => row.date !== '2024-06-03')
    dashboard.states.H30269.data = missing; await flush()
    assert.match(view.text(), /缺少 1 个交易日行情/); assert.match(view.text(), /不跨缺口连线/)
    view.field('查看持有期买入日').props['onUpdate:modelValue']('2023-03-01'); await nextTick()
    assert.match(view.text(), /窗口.*存在缺失行情，未纳入统计/)
  } finally { view.unmount() }
})

test('charts delay hidden updates, replace both term/identity/basis and dispose on unmount', async () => {
  const previousObserver = globalThis.ResizeObserver
  let notify, disposed = false, disconnected = false
  const options = [], chart = { setOption(value) { options.push(value) }, resize() {}, dispose() { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  const stats = calculateHoldingPeriods(market(), { distribution: distribution(), now: new Date(stamp) })
  let view
  try {
    view = await mount(null, { chartSeries: stats.series[0], chart })
    assert.equal(options.length, 1)
    const canvas = view.nodes().find(n => n.props.class === 'holding-period-charts')
    canvas.clientWidth = 0; view.props.series = stats.series[1]; view.props.code = 'H30269'; view.props.basis = 'price'; await nextTick()
    assert.equal(options.length, 1)
    canvas.clientWidth = 700; notify(); assert.equal(options.length, 2); assert.match(options.at(-1).title[0].text, /持有 3 年/)
    assert.match(canvas.props['aria-label'], /H30269持有3年.*价格收益/)
    view.unmount(); view = null; assert.ok(disposed && disconnected)
  } finally { view?.unmount(); globalThis.ResizeObserver = previousObserver }
})
