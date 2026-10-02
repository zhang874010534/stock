import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { tradingSessions } from '../src/utils/priceRisk.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'
import { INVESTMENT_PLANS_KEY } from '../src/composables/useInvestmentPlans.js'

const NativeDate = Date
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
function market(code, multiplier = 1) {
  const history = tradingSessions('2026-01-05', '2026-03-31', tradingCalendar).map((date, i) => {
    const close = multiplier * (10 + i / 10); return { date, open: close, close, high: close, low: close }
  })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: '2026-03-31T12:00:00Z', backfill: { completed: false }, history, latest: history.at(-1) }
}
const distribution = () => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', coverage: { start: '2018-12-19', end: '2026-10-01' }, checkedAt: '2026-10-01T08:00:00.000Z', status: 'ok', reason: null, dividends: [], splits: [] })
async function mount(dashboard, { trendStats, chart, storage } = {}) {
  const previous = { Date: globalThis.Date, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot, localStorage: globalThis.localStorage, document: globalThis.document }
  const entries = new Map(), downloads = [], blobs = [], originalCreateUrl = URL.createObjectURL, originalRevokeUrl = URL.revokeObjectURL
  storage ??= { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  globalThis.localStorage = storage
  globalThis.document = { body: { append() {} }, createElement: () => ({ click() { downloads.push(this.download) }, remove() {} }) }
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:simulator-test' }; URL.revokeObjectURL = () => {}
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-10-01T08:00:00.000Z'])) } }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL(`../src/components/${trendStats ? 'InvestmentSimulationTrend' : 'InvestmentSimulator'}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'simulator-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const InvestmentSimulationTrend = defineAsyncComponent\(\(\) => import\([^\n]+/, "const InvestmentSimulationTrend = { props: ['stats'], setup(props) { return () => testH('div', { simulation: props.stats }) } }")
    .replace(/import \{ initEtfReturn as initTrend \} from ['"][^'"]+['"]/, 'const initTrend = element => element.chart')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', chart, clientWidth: 600, clientHeight: 340, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}), get options() { return this.children.filter(n => n.tag === 'option') } })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const host = node('host'), props = reactive(trendStats ? { stats: trendStats } : { instrument: '512890' })
  const app = renderer.createApp({ setup() { if (dashboard) provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, storage, downloads, blobs, button: text => all(host).find(n => n.tag === 'button' && n.text === text), nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), stats: () => all(host).find(n => n.props.simulation)?.props.simulation,
    namedField: label => all(host).find(n => n.props['aria-label'] === label),
    field: label => all(host).find(n => n.tag === 'label' && all(n).some(c => c.text === label))?.children.find(n => ['input', 'select'].includes(n.tag)),
    run: () => all(host).find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }),
    unmount() { app.unmount(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl } }
}
function loaders(extra = {}) { return { '512890': () => market('512890'), H30269: () => market('H30269', 100), etfDistributions: distribution, collection: () => ({ sources: { '512890': { status: 'ok' }, H30269: { status: 'ok' } } }), ...extra } }

test('form applies only on submit, ledger follows strategy, and invalid ranges do not retain a misleading chart', async () => {
  const view = await mount(createDashboardData(loaders()))
  try {
    await flush(); assert.equal(view.stats().series.length, 4); assert.equal(view.stats().config.budget, 50000)
    assert.match(view.text(), /同一天有多个计划/); assert.match(view.text(), /不是年化收益/)
    view.field('总预算（元）').props['onUpdate:modelValue']('1000'); await nextTick()
    assert.equal(view.stats().config.budget, 50000)
    assert.match(view.text(), /仍为上次模拟结果/)
    view.field('份额模式').props['onUpdate:modelValue']('fractional'); view.run(); await flush()
    assert.equal(view.stats().config.budget, 1000)
    view.field('明细策略').props['onUpdate:modelValue']('lump'); await nextTick(); assert.match(view.text(), /1 笔成交/)
    view.field('开始日期').props['onUpdate:modelValue']('2026-04-01'); view.run(); await flush()
    assert.match(view.text(), /开始日期必须早于/); assert.equal(view.stats(), undefined)
    view.field('开始日期').props['onUpdate:modelValue']('2026-01-05'); view.field('每笔最低费用（元）').props['onUpdate:modelValue'](''); view.run(); await flush()
    assert.match(view.text(), /请填写完整/)
  } finally { view.unmount() }
})

test('hidden trend waits for size, renders the latest inputs and releases its chart on unmount', async () => {
  const previousObserver = globalThis.ResizeObserver
  let notify, disposed = false, disconnected = false
  const options = [], chart = { setOption(value) { options.push(value) }, resize() {}, dispose() { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  const m = market('512890')
  const { calculateInvestmentSimulation, simulatorDefaults } = await import('../src/utils/investmentSimulator.js')
  const result = budget => calculateInvestmentSimulation(m, { ...simulatorDefaults(m), budget }, { distribution: distribution(), now: new Date('2026-10-01T08:00:00Z') })
  let view
  try {
    view = await mount(null, { trendStats: result(50000), chart })
    assert.equal(options.length, 1)
    const canvas = view.nodes().find(n => n.props.class === 'simulation-trend')
    canvas.clientWidth = 0; view.props.stats = result(10000); await nextTick(); assert.equal(options.length, 1)
    canvas.clientWidth = 600; notify(); assert.equal(options.length, 2)
    assert.equal(options.at(-1).series.at(-1).data[0], 10000)
    view.unmount(); view = null; assert.ok(disposed && disconnected)
  } finally { view?.unmount(); globalThis.ResizeObserver = previousObserver }
})

test('failed group refresh retains both inputs, success replaces them, switching resets instrument identity', async () => {
  let fail = false, multiplier = 1, distributionsCalls = 0
  const dashboard = createDashboardData(loaders({ '512890': () => market('512890', multiplier), etfDistributions: () => { distributionsCalls++; if (fail) throw new Error('offline'); return distribution() } }))
  const view = await mount(dashboard)
  try {
    await flush(); const original = JSON.parse(JSON.stringify(view.stats()))
    multiplier = 2; fail = true; await dashboard.refresh(['512890', 'etfDistributions']); await flush()
    assert.match(view.text(), /保留上次整组/); assert.deepEqual(view.stats(), original)
    fail = false; await dashboard.refresh(['512890', 'etfDistributions']); await flush()
    assert.notEqual(view.stats().series[0].current.shares, original.series[0].current.shares)
    const count = distributionsCalls; view.props.instrument = 'H30269'; await flush()
    assert.equal(distributionsCalls, count); assert.equal(view.stats().code, 'H30269'); assert.equal(view.stats().config.quantityMode, 'fractional')
    assert.match(view.text(), /不能直接买入/); assert.equal(view.field('份额模式'), undefined)
    view.props.instrument = '512890'; await flush(); assert.equal(view.stats().code, '512890'); assert.equal(view.stats().config.quantityMode, 'lots')
  } finally { view.unmount() }
})

test('missing or uncovered distributions block ETF results while index remains independently available', async () => {
  const dashboard = createDashboardData(loaders({ etfDistributions: () => { throw new Error('missing') } }))
  const view = await mount(dashboard)
  try {
    await flush(); assert.match(view.text(), /暂无完整模拟输入/); assert.equal(view.stats(), undefined)
    view.props.instrument = 'H30269'; await flush(); assert.ok(view.stats()); assert.ok(!view.text().includes('missing'))
    view.props.instrument = '512890'; dashboard.states.etfDistributions.data = { ...distribution(), coverage: { start: '2018-12-19', end: '2026-01-31' }, checkedAt: '2026-01-31T08:00:00.000Z' }; await flush()
    assert.match(view.text(), /核验范围未覆盖/); assert.equal(view.stats(), undefined)
  } finally { view.unmount() }
})

test('monthly funding and reinvestment apply on submit; plans reload independently, preserve old versions and isolate instruments', async () => {
  const entries = new Map(), storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  let view = await mount(createDashboardData(loaders()), { storage })
  try {
    await flush()
    view.namedField('定投资金来源').props['onUpdate:modelValue']('monthly'); await nextTick()
    view.field('总预算（元）').props['onUpdate:modelValue']('0')
    view.field('每月新增资金（元）').props['onUpdate:modelValue']('500')
    view.field('份额模式').props['onUpdate:modelValue']('fractional')
    view.field('收益口径').props['onUpdate:modelValue']('reinvest')
    assert.equal(view.stats().config.fundingMode, 'upfront')
    view.run(); await flush()
    assert.equal(view.stats().series[0].current.contributed, 1500)
    assert.equal(view.stats().config.basis, 'reinvest'); assert.match(view.text(), /费用敏感性/); assert.match(view.text(), /每月入金/)
    view.namedField('定投方案名称').props['onUpdate:modelValue']('<img src=x> 月新增'); await nextTick()
    view.button('另存为新方案').props.onClick(); await nextTick()
    const first = JSON.parse(storage.getItem(INVESTMENT_PLANS_KEY)).plans[0]
    assert.equal(first.config.budget, 0); assert.equal(first.config.monthlyAmount, 500); assert.equal(first.strategy, 'weekly')
    assert.ok(!view.nodes().some(node => node.tag === 'img'))
    view.field('每月新增资金（元）').props['onUpdate:modelValue']('1000'); await nextTick()
    assert.equal(view.button('另存为新方案').props.disabled, true)
    view.run(); await flush(); view.field('明细策略').props['onUpdate:modelValue']('monthly'); await nextTick()
    view.button('另存为新方案').props.onClick(); await nextTick()
    assert.equal(JSON.parse(storage.getItem(INVESTMENT_PLANS_KEY)).plans.length, 2)
    view.namedField('已保存定投方案').props['onUpdate:modelValue'](first.id); await nextTick(); view.button('加载方案').props.onClick(); await flush()
    assert.equal(view.stats().config.monthlyAmount, 500); assert.ok(view.nodes().some(node => node.tag === 'caption' && /费用敏感性.*每周定投/.test(node.text)))
    view.button('删除方案').props.onClick(); await nextTick(); view.button('撤销删除方案').props.onClick(); await nextTick()
    assert.equal(JSON.parse(storage.getItem(INVESTMENT_PLANS_KEY)).plans.length, 2)
    view.unmount(); view = await mount(createDashboardData(loaders()), { storage }); await flush()
    view.namedField('已保存定投方案').props['onUpdate:modelValue'](first.id); await nextTick(); view.button('加载方案').props.onClick(); await flush()
    assert.equal(view.stats().config.budget, 0)
    view.props.instrument = 'H30269'; await flush(); assert.ok(!view.text().includes('<img src=x> 月新增'))
    assert.equal(view.stats().config.basis, 'price'); assert.equal(view.button('加载方案').props.disabled, true)
  } finally { view.unmount() }
})

test('cash flow CSV includes selected strategy amounts and no duplicate dividend capital; storage errors and invalid fee parameters explain failure', async () => {
  const events = () => ({ ...distribution(), dividends: [{ recordDate: '2026-01-06', exDate: '2026-01-07', payDate: '2026-01-09', cashPerShare: 1 }] })
  const view = await mount(createDashboardData(loaders({ etfDistributions: events })), { storage: { getItem: () => null, setItem() { throw new Error('denied') } } })
  try {
    await flush(); view.field('份额模式').props['onUpdate:modelValue']('fractional'); view.field('收益口径').props['onUpdate:modelValue']('reinvest')
    view.run(); await flush(); view.field('明细策略').props['onUpdate:modelValue']('lump'); await nextTick()
    view.button('导出现金流 CSV').props.onClick(); await nextTick()
    assert.ok(view.downloads[0].endsWith('_现金流.csv'))
    const csv = await view.blobs[0].text(); assert.match(csv, /现金余额/); assert.match(csv, /分红再投资/); assert.match(csv, /内部现金流/)
    const s = view.stats().series[0]
    assert.equal(s.current.contributed, 50000); assert.ok(s.current.reinvested > 0)
    view.button('另存为新方案').props.onClick(); await nextTick(); assert.match(view.text(), /名称须为/)
    view.namedField('定投方案名称').props['onUpdate:modelValue']('拒绝存储测试'); await nextTick(); view.button('另存为新方案').props.onClick(); await nextTick()
    assert.match(view.text(), /方案保存失败/)
    view.field('对照买入费率（%）').props['onUpdate:modelValue']('6'); view.run(); await flush()
    assert.match(view.text(), /费用参数超出/); assert.equal(view.stats(), undefined)
  } finally { view.unmount() }
})

test('saved plans with dates outside current data show the original range and fail explicitly without clamping', async () => {
  const saved = { id: 'old-plan', instrument: '512890', name: '原始区间', strategy: 'monthly', savedAt: '2026-04-01T08:00:00.000Z', config: { start: '2025-01-01', end: '2026-03-31', budget: 1000, weekday: 1, monthDay: 5, batchCount: 6, batchInterval: 30, feePercent: 0, minFee: 0, quantityMode: 'fractional', basis: 'cash' } }
  const view = await mount(createDashboardData(loaders()), { storage: { getItem: () => JSON.stringify({ schemaVersion: 1, plans: [saved] }), setItem() {} } })
  try {
    await flush(); view.namedField('已保存定投方案').props['onUpdate:modelValue']('old-plan'); await nextTick()
    view.button('加载方案').props.onClick(); await flush()
    assert.equal(view.field('开始日期').value, '2025-01-01'); assert.match(view.text(), /超出已同步行情范围/); assert.equal(view.stats(), undefined)
    assert.equal(view.button('另存为新方案').props.disabled, true)
  } finally { view.unmount() }
})
