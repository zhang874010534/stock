import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'

async function mount(name, initial, dashboard, chart) {
  const previousDocumentClass = globalThis.Document, previousShadowClass = globalThis.ShadowRoot
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'comparison-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const IndexComparisonTrend = defineAsyncComponent\([^\n]+/, "const IndexComparisonTrend = { props: ['stats', 'selection'], setup(props) { return () => testH('div', { chartStats: props.stats, selection: props.selection }) } }")
    .replace(/import \{ initIndexComparison \} from ['"][^'"]+['"]/, 'const initIndexComparison = element => element.chart')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', clientWidth: 900, clientHeight: 700, chart,
    addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}) })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), props = reactive(initial)
  const app = renderer.createApp({ setup() { if (dashboard) provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, unmount: () => { app.unmount(); globalThis.Document = previousDocumentClass; globalThis.ShadowRoot = previousShadowClass }, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '),
    button: label => all(host).find(n => n.tag === 'button' && n.text === label), stats: () => all(host).find(n => n.props.chartStats)?.props.chartStats }
}
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
function market(code, version = 1) {
  const history = []
  for (let time = Date.parse('2025-01-01T00:00:00Z'); time <= Date.parse('2026-09-29T00:00:00Z'); time += 86400_000) {
    const date = new Date(time), day = date.toISOString().slice(0, 10)
    if ([0, 6].includes(date.getUTCDay()) || tradingCalendar.closures.some(([s, e]) => day >= s && day <= e)) continue
    const close = 100 + (history.length % 11) * version
    history.push({ date: day, open: close, close, high: close, low: close })
  }
  return { code, name: code, source: 'eastmoney', interval: '1d', history, latest: history.at(-1),
    updatedAt: '2026-09-29T10:00:00Z', backfill: { completed: false } }
}

test('对比固定指数身份，区间重算和自定义应用；一侧失败保留整份旧比较，重试后整体替换', async () => {
  let version = 1, fail = false, releaseIndex
  const calls = []
  const dashboard = createDashboardData({
    H30269: () => { calls.push('H30269'); if (version === 3) return new Promise(done => { releaseIndex = () => done(market('H30269', version)) }); return market('H30269', version) },
    '000300': () => { calls.push('000300'); if (fail) throw new Error('offline'); return market('000300') },
    collection: () => ({ schemaVersion: 1, sources: {} }),
  })
  const view = await mount('IndexComparisonAnalysis', { instrument: '512890' }, dashboard)
  try {
    await flush()
    assert.match(view.text(), /不代表 512890 实际持有收益/)
    assert.equal(view.stats().startDate, '2025-09-29')
    const original = view.stats()
    version = 2; fail = true
    await dashboard.refresh(['000300']); await flush()
    assert.equal(view.stats(), original)
    assert.match(view.text(), /保留上次对比输入及原日期/)
    assert.match(view.text(), /offline/)
    fail = false; version = 3
    const refreshing = dashboard.refresh(['000300']); await flush()
    assert.equal(view.stats(), original) // benchmark has arrived, index is still pending
    releaseIndex(); await refreshing; await flush()
    assert.notEqual(view.stats(), original)
    assert.ok(!view.text().includes('offline'))
    assert.equal(calls.filter(x => x === 'H30269').length, 3)
    assert.equal(calls.filter(x => x === '000300').length, 3)
    view.button('年初至今').props.onClick(); await nextTick()
    assert.equal(view.stats().startDate, '2025-12-31')
    view.button('近3年').props.onClick(); await nextTick()
    assert.match(view.text(), /共同历史不足/)
    assert.equal(view.stats(), undefined)
    view.button('近1年').props.onClick(); await nextTick()
    view.button('自定义').props.onClick(); await nextTick()
    const inputs = view.nodes().filter(n => n.tag === 'input')
    assert.equal(inputs[0].value, '2025-09-29')
    inputs[0].props['onUpdate:modelValue']('2026-01-03')
    inputs[1].props['onUpdate:modelValue']('2026-02-06')
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await nextTick()
    assert.equal(view.stats().startDate, '2026-01-05')
    assert.equal(view.stats().endDate, '2026-02-06')
    view.props.instrument = 'H30269'; await nextTick()
    assert.ok(!view.text().includes('不代表 512890 实际持有收益'))
    assert.equal(view.stats().series[1].code, '000300')
  } finally { view.unmount() }
})

test('初次读取失败不显示虚假零收益，输入缺交易日时隐藏完整比较并给出日期', async () => {
  let fail = true
  const dashboard = createDashboardData({ H30269: () => market('H30269'),
    '000300': () => { if (fail) throw new Error('not available'); const data = market('000300'); data.history = data.history.filter(row => row.date !== '2026-01-06'); return data },
    collection: () => ({ schemaVersion: 1, sources: {} }),
  })
  const view = await mount('IndexComparisonAnalysis', { instrument: 'H30269' }, dashboard)
  try {
    await flush()
    assert.equal(view.stats(), undefined)
    assert.match(view.text(), /暂无可用对比数据/)
    assert.ok(!view.text().includes('0.00%'))
    fail = false
    await view.button('重新读取对比').props.onClick(); await flush()
    assert.equal(view.stats(), undefined)
    assert.match(view.text(), /000300 缺少 1 个交易日：2026-01-06/)
  } finally { view.unmount() }
})

test('图表刷新保留日期缩放，修改计算区间重置缩放；隐藏时延迟绘制，卸载释放资源', async () => {
  const previousObserver = globalThis.ResizeObserver
  let notify, disconnected = false, disposed = false, option, resizeCount = 0
  const options = []
  const chart = { getOption: () => option, setOption: value => { option = value; options.push(value) }, resize: () => resizeCount++, dispose: () => { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  const { calculateIndexComparison } = await import('../src/utils/indexComparison.js')
  const stats = range => calculateIndexComparison(market('H30269'), market('000300'), { range })
  let view
  try { view = await mount('IndexComparisonTrend', { stats: stats('year'), selection: 'year' }, null, chart) }
  finally { globalThis.ResizeObserver = previousObserver }
  try {
    assert.equal(options.length, 1)
    option = { dataZoom: [{ start: 25, end: 75 }] }
    const canvas = view.nodes().find(n => n.props.class === 'comparison-canvas')
    canvas.clientWidth = 0
    view.props.stats = stats('year'); await nextTick()
    assert.equal(options.length, 1)
    canvas.clientWidth = 900; notify()
    assert.equal(options.length, 2)
    assert.ok(options.at(-1).dataZoom[0].startValue > 0)
    notify(); assert.equal(options.length, 2)
    view.props.stats = stats('ytd'); view.props.selection = 'ytd'; await nextTick()
    assert.equal(options.at(-1).dataZoom[0].startValue, 0)
    assert.equal(options.at(-1).dataZoom[0].endValue, view.props.stats.count - 1)
    assert.ok(resizeCount >= 3)
  } finally { view.unmount() }
  notify(); assert.equal(disconnected, true); assert.equal(disposed, true)
})
