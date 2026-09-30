import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { calculateDrawdown } from '../src/utils/drawdown.js'

async function mount(name, initial, chart) {
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'drawdown-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/import DrawdownTrend from ['"][^'"]+['"]/, "const DrawdownTrend = { props: ['stats', 'instrument'], setup(props) { return () => testH('div', { chartStats: props.stats, chartInstrument: props.instrument }) } }")
    .replace(/import \{ initDrawdown \} from ['"][^'"]+['"]/, 'const initDrawdown = element => element.chart')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, children: [], props: {}, text: '', clientWidth: 600, clientHeight: 300, chart })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), props = reactive(initial)
  const app = renderer.createApp({ render: () => h(component, props) })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, unmount: () => app.unmount(), nodes: () => all(host), text: () => all(host).map(n => n.text).join(' ') }
}
const rows = prices => prices.map((close, i) => ({ date: `2026-01-0${i + 1}`, close }))

test('摘要分开显示最大回撤恢复和当前回撤；切换证券、读取失败、单样本和空数据均有正确说明', async () => {
  let retries = 0
  const view = await mount('DrawdownAnalysis', { instrument: '512890', history: rows([100, 80, 100, 95]), backfillCompleted: false, onRetry: () => retries++ })
  try {
    assert.match(view.text(), /ETF 未复权价格/)
    assert.match(view.text(), /-5.00%/)
    assert.match(view.text(), /-20.00%/)
    assert.match(view.text(), /已恢复/)
    assert.match(view.text(), /尚未恢复/)
    assert.match(view.text(), /2026-01-03 收盘首次回到原高点/)
    assert.match(view.text(), /已同步历史：2026-01-01 — 2026-01-04/)
    const before = view.nodes().find(n => n.props.chartStats).props.chartStats
    view.props.error = 'offline'
    await nextTick()
    assert.match(view.text(), /保留上次回撤曲线与原日期/)
    assert.deepEqual(view.nodes().find(n => n.props.chartStats).props.chartStats, before)
    view.nodes().find(n => n.tag === 'button').props.onClick()
    assert.equal(retries, 1)
    view.props.loading = true
    await nextTick()
    assert.equal(view.nodes().find(n => n.tag === 'button').props.disabled, true)
    Object.assign(view.props, { instrument: 'H30269', error: '', loading: false, history: rows([1, 2]), backfillCompleted: true })
    await nextTick()
    assert.match(view.text(), /价格指数，不含分红再投资/)
    assert.match(view.text(), /无需恢复/)
    assert.ok(!view.text().includes('ETF 未复权价格'))
    assert.equal(view.nodes().find(n => n.props.chartStats).props.chartInstrument, 'H30269')
    view.props.history = rows([1])
    await nextTick()
    assert.match(view.text(), /仅有一个收盘样本/)
    assert.ok(!view.nodes().some(n => n.props.chartStats))
    assert.ok(!view.text().includes('0.00%'))
    view.props.history = []
    await nextTick()
    assert.match(view.text(), /暂无可用收盘行情/)
    view.props.history = rows([1, 0])
    await nextTick()
    assert.match(view.text(), /无法计算回撤/)
  } finally { view.unmount() }
})

test('隐藏更新恢复时绘制最新回撤、保留日期缩放；resize 不重置窗口，卸载后不再渲染', async () => {
  const previousObserver = globalThis.ResizeObserver
  let notify, disconnected = false, disposed = false, option, resizeCount = 0
  const options = []
  const chart = { getOption: () => option, setOption: value => { option = value; options.push(value) }, resize: () => resizeCount++, dispose: () => { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  let view
  try { view = await mount('DrawdownTrend', { instrument: '512890', stats: calculateDrawdown(rows([100, 90, 80, 95, 100])) }, chart) }
  finally { globalThis.ResizeObserver = previousObserver }
  try {
    assert.equal(options.length, 1) // A new ECharts instance has no option yet.
    option = { dataZoom: [{ start: 25, end: 75 }] }
    const canvas = view.nodes().find(n => n.props.class === 'drawdown-canvas')
    canvas.clientWidth = 0
    notify()
    view.props.stats = calculateDrawdown([{ date: '2025-12-31', close: 100 }, ...rows([100, 90, 80, 95, 100])])
    await nextTick()
    view.props.stats = calculateDrawdown([{ date: '2025-12-31', close: 100 }, ...rows([100, 90, 80, 95, 100, 70])])
    await nextTick()
    assert.equal(options.length, 1)
    canvas.clientWidth = 600
    notify()
    assert.equal(options.length, 2)
    assert.equal(options.at(-1).dataZoom[0].startValue, 2)
    assert.equal(options.at(-1).dataZoom[0].endValue, 4)
    assert.equal(options.at(-1).series[0].markPoint.data[0].value, '-30.00%')
    assert.equal(options.at(-1).xAxis.data.at(-1), '2026-01-06')
    notify()
    assert.equal(options.length, 2)
    assert.equal(resizeCount, 3)
  } finally { view.unmount() }
  notify()
  assert.equal(disposed, true)
  assert.equal(disconnected, true)
  assert.equal(options.length, 2)
})
