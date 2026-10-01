import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { tradingSessions } from '../src/utils/priceRisk.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'

const NativeDate = Date
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
function market(code, multiplier = 1) {
  const history = tradingSessions('2026-01-05', '2026-03-31', tradingCalendar).map((date, i) => {
    const close = multiplier * (10 + i / 10); return { date, open: close, close, high: close, low: close }
  })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: '2026-03-31T12:00:00Z', backfill: { completed: false }, history, latest: history.at(-1) }
}
const distribution = () => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', coverage: { start: '2018-12-19', end: '2026-10-01' }, checkedAt: '2026-10-01T08:00:00.000Z', status: 'ok', reason: null, dividends: [], splits: [] })
async function mount(dashboard, { trendStats, chart } = {}) {
  const previous = { Date: globalThis.Date, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot }
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
  return { props, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), stats: () => all(host).find(n => n.props.simulation)?.props.simulation,
    field: label => all(host).find(n => n.tag === 'label' && all(n).some(c => c.text === label))?.children.find(n => ['input', 'select'].includes(n.tag)),
    run: () => all(host).find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }),
    unmount() { app.unmount(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } } }
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
