import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { calculateEtfReturn, ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'

const stamp = '2026-09-30T12:00:00.000Z'
const data = () => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', coverage: { start: '2018-12-19', end: '2026-09-30' }, checkedAt: stamp, status: 'ok', reason: null,
  dividends: [{ recordDate: '2026-09-28', exDate: '2026-09-29', payDate: '2026-10-09', cashPerShare: .1 }], splits: [{ date: '2021-10-22', ratio: 2 }] })
const rows = [1, .9, .95].map((close, index) => ({ date: `2026-09-${28 + index}`, close }))
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }

async function mount(name, initial, dashboard, chart) {
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'etf-component-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const EtfReturnTrend = defineAsyncComponent\(\(\) => import\([^\n]+/, "const EtfReturnTrend = { props: ['stats', 'range'], setup(props) { return () => testH('div', { chartStats: props.stats, chartRange: props.range }) } }")
    .replace(/import \{ initEtfReturn \} from ['"][^'"]+['"]/, 'const initEtfReturn = element => element.chart')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, children: [], props: {}, text: '', clientWidth: 600, clientHeight: 310, chart })
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
  return { props, unmount: () => app.unmount(), nodes: () => all(host), text: () => all(host).map(n => n.text).join(' ') }
}

test('收益摘要分开展示价格、现金与含分红收益；应收和发放、计算日期及分红记录日期独立', async () => {
  let fail = false
  const dashboard = createDashboardData({ etfDistributions: async () => { if (fail) throw new Error('offline'); return data() } })
  const view = await mount('EtfIncomeAnalysis', { history: rows, backfillCompleted: false }, dashboard)
  try {
    await flush()
    assert.match(view.text(), /-5.00%/)
    assert.match(view.text(), /\+5.00%/)
    assert.match(view.text(), /0.1000 元/)
    assert.match(view.text(), /应收未到账/)
    assert.match(view.text(), /2026-09-28 — 2026-09-30/)
    assert.match(view.text(), /2018-12-19 — 2026-09-30/)
    assert.match(view.text(), /2021-10-22/)
    assert.match(view.text(), /1 份变为 2 份，不产生现金分红/)
    const previous = view.nodes().find(n => n.props.chartStats).props.chartStats
    fail = true; await dashboard.refresh(['etfDistributions']); await flush()
    assert.match(view.text(), /保留原记录及核验范围/)
    assert.deepEqual(view.nodes().find(n => n.props.chartStats).props.chartStats, previous)
    view.props.error = 'market offline'; await nextTick()
    assert.match(view.text(), /行情读取失败，沿用已显示行情及原日期/)
    view.props.history = [...rows, { date: '2026-10-09', close: .96 }]; await nextTick()
    assert.match(view.text(), /分红核验范围未覆盖行情区间/)
    assert.ok(!view.nodes().some(n => n.props.chartStats))
    view.props.history = rows; await nextTick()
    view.nodes().find(n => n.tag === 'button' && n.text === '年初至今').props.onClick(); await nextTick()
    assert.match(view.text(), /缺少上年末最后交易日收盘价/)
    assert.ok(!view.nodes().some(n => n.props.chartStats))
  } finally { view.unmount() }
})

test('分红加载／无旧值失败不显示零分红；明确空记录才显示重合；stale 标明原核验日期', async () => {
  let reject
  const dashboard = createDashboardData({ etfDistributions: () => new Promise((resolve, failure) => { reject = failure }) })
  const view = await mount('EtfIncomeAnalysis', { history: rows }, dashboard)
  try {
    assert.match(view.text(), /正在读取 ETF 分红记录/)
    await Promise.resolve(); reject(new Error('missing')); await flush()
    assert.match(view.text(), /不能确认未分红/)
    assert.ok(!view.text().includes('0.0000 元'))
    assert.ok(!view.nodes().some(n => n.props.chartStats))
    dashboard.states.etfDistributions.data = { ...data(), dividends: [], status: 'stale', reason: '采集失败，保留原日期' }
    await nextTick()
    assert.match(view.text(), /采集失败，保留原日期/)
    assert.match(view.text(), /截至 2026-09-30 的来源档案暂无现金分红记录/)
    assert.match(view.text(), /曲线重合/)
    const stats = view.nodes().find(n => n.props.chartStats).props.chartStats
    assert.equal(stats.current.priceReturn, stats.current.totalReturn)
    dashboard.states.etfDistributions.data = { ...data(), dividends: [], splits: [], status: 'unavailable', reason: '不可用', coverage: null, checkedAt: null }
    await nextTick()
    assert.match(view.text(), /不能按零分红计算/)
    assert.ok(!view.nodes().some(n => n.props.chartStats))
  } finally { view.unmount() }
})

test('隐藏更新只绘制最新收益；刷新保留缩放，区间切换重置，卸载释放图表', async () => {
  const previousObserver = globalThis.ResizeObserver
  let notify, disposed = false, disconnected = false, option
  const options = []
  const chart = { getOption: () => option, setOption(value) { option = value; options.push(value) }, resize() {}, dispose() { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  const stats = history => calculateEtfReturn(history, data(), { now: new Date(stamp) })
  let view
  try {
    view = await mount('EtfReturnTrend', { stats: stats(rows), range: 'all' }, null, chart)
    option = { dataZoom: [{ start: 50, end: 100 }] }
    const canvas = view.nodes().find(n => n.props.class === 'etf-return-canvas')
    canvas.clientWidth = 0
    view.props.stats = stats([{ date: '2026-09-25', close: 1 }, ...rows]); await nextTick()
    assert.equal(options.length, 1)
    canvas.clientWidth = 600; notify()
    assert.equal(options.length, 2)
    assert.equal(options.at(-1).dataZoom[0].startValue, 2)
    view.props.range = 'year'; await nextTick()
    assert.equal(options.at(-1).dataZoom[0].startValue, 0)
    notify(); assert.equal(options.length, 3)
  } finally { view?.unmount(); globalThis.ResizeObserver = previousObserver }
  notify()
  assert.equal(disposed, true)
  assert.equal(disconnected, true)
  assert.equal(options.length, 3)
})
