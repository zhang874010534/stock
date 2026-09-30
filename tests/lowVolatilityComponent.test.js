import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { tradingCalendar } from '../src/data/tradingCalendar.js'

async function mount(name, initial, chart) {
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'low-volatility-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const LowVolatilityTrend = defineAsyncComponent\([^\n]+/, "const LowVolatilityTrend = { props: ['stats', 'selection'], setup(props) { return () => testH('div', { chartStats: props.stats, selection: props.selection }) } }")
    .replace(/import \{ initLowVolatility \} from ['"][^'"]+['"]/, 'const initLowVolatility = element => element.chart')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, children: [], props: {}, text: '', clientWidth: 900, clientHeight: 320, chart })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), props = reactive(initial)
  const app = renderer.createApp({ setup: () => () => h(component, props) })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, unmount: () => app.unmount(), nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '),
    button: label => all(host).find(n => n.tag === 'button' && n.text === label), stats: () => all(host).find(n => n.props.chartStats)?.props.chartStats }
}
function market(code, end = '2026-09-29') {
  const history = []
  for (let time = Date.parse('2025-01-01'); time <= Date.parse(end); time += 86400_000) {
    const date = new Date(time), day = date.toISOString().slice(0, 10)
    if ([0, 6].includes(date.getUTCDay()) || tradingCalendar.closures.some(([s, e]) => day >= s && day <= e)) continue
    const close = 100 + history.length % 11
    history.push({ date: day, open: close, close, high: close, low: close })
  }
  return { code, name: code, source: 'eastmoney', interval: '1d', history, latest: history.at(-1), updatedAt: '2026-09-29T10:00:00Z', backfill: { completed: false } }
}

test('区间、窗口、月详情交互正确；月内不排名，ETF与指数切换拒绝旧身份行情', async () => {
  const view = await mount('LowVolatilityAnalysis', { instrument: '512890', market: market('512890') })
  try {
    assert.match(view.text(), /ETF 未复权收盘价/)
    const original = view.stats()
    view.button('20日').props.onClick(); await nextTick()
    assert.equal(view.stats().rollingSessions, 20)
    assert.equal(view.stats().annualizedVolatility, original.annualizedVolatility)
    assert.deepEqual(view.stats().months, original.months)
    const partial = view.nodes().find(n => n.props['aria-label']?.startsWith('2026-09，'))
    partial.props.onClick(); await nextTick()
    assert.match(view.text(), /2026-09 · 月内收益/)
    assert.ok(view.stats().worstMonths.every(m => m.month !== '2026-09'))
    view.button('年初至今').props.onClick(); await nextTick()
    assert.equal(view.stats().startDate, '2025-12-31')
    assert.equal(view.stats().months[0].month, '2026-01')
    assert.match(view.text(), /完整月份 ·/)
    view.button('近3年').props.onClick(); await nextTick()
    assert.equal(view.stats(), undefined); assert.match(view.text(), /历史不足/)
    view.button('近1年').props.onClick(); await nextTick()
    view.props.instrument = 'H30269'; await nextTick()
    assert.equal(view.stats(), undefined); assert.match(view.text(), /证券与当前选择不一致/)
    view.props.market = market('H30269'); await nextTick()
    assert.equal(view.stats().code, 'H30269')
    assert.match(view.text(), /使用价格指数日收盘/)
  } finally { view.unmount() }
})

test('读取失败与加载保留已有分析和日期，重试通知父页面；首次空值不伪造零波动率', async () => {
  let retries = 0
  const view = await mount('LowVolatilityAnalysis', { instrument: 'H30269', market: market('H30269'), onRetry: () => retries++ })
  try {
    const original = view.stats()
    view.props.loading = true; await nextTick()
    assert.equal(view.stats(), original); assert.match(view.text(), /暂显示上次分析/)
    view.props.loading = false; view.props.error = 'offline'; await nextTick()
    assert.equal(view.stats(), original); assert.match(view.text(), /保留上次分析和原日期/)
    assert.match(view.text(), /offline/)
    view.button('重新读取').props.onClick(); assert.equal(retries, 1)
    assert.match(view.text(), /2026-09-29/)
    view.props.market = null; await nextTick()
    assert.equal(view.stats(), undefined); assert.match(view.text(), /暂无可用分析/)
    assert.ok(!view.text().includes('0.00%'))
  } finally { view.unmount() }
})

test('图表刷新与窗口变更保留日期缩放，区间或证券变更重置；隐藏延迟渲染并释放资源', async () => {
  const previousObserver = globalThis.ResizeObserver
  let notify, disconnected = false, disposed = false, option
  const options = []
  const chart = { getOption: () => option, setOption: value => { option = value; options.push(value) }, resize() {}, dispose: () => { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  const { calculateLowVolatility } = await import('../src/utils/lowVolatility.js')
  const stats = (rollingSessions = 60, range = 'all') => calculateLowVolatility(market('H30269'), { rollingSessions, range })
  let view
  try { view = await mount('LowVolatilityTrend', { stats: stats(), selection: 'H30269:all' }, chart) }
  finally { globalThis.ResizeObserver = previousObserver }
  try {
    assert.equal(options.length, 1)
    option = { dataZoom: [{ start: 25, end: 75 }] }
    const canvas = view.nodes().find(n => n.props.class === 'low-volatility-canvas')
    canvas.clientWidth = 0; view.props.stats = stats(20); await nextTick()
    assert.equal(options.length, 1)
    canvas.clientWidth = 900; notify()
    assert.equal(options.length, 2); assert.ok(option.dataZoom[0].startValue > 0)
    notify(); assert.equal(options.length, 2)
    view.props.stats = stats(120, 'ytd'); view.props.selection = 'H30269:ytd'; await nextTick()
    assert.equal(option.dataZoom[0].startValue, 0)
    assert.equal(option.dataZoom[0].endValue, view.props.stats.count - 1)
  } finally { view.unmount() }
  notify(); assert.equal(disconnected, true); assert.equal(disposed, true)
})
