import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive, ref } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createPortfolioLedger, providePortfolioLedger } from '../src/composables/usePortfolioLedger.js'
import { calculatePortfolioHistory } from '../src/utils/portfolioHistory.js'

async function mount(relative, initial, store, chart) {
  const file = new URL(`../src/components/${relative}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const source = compileScript(descriptor, { id: 'ledger-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/const PortfolioHistoryTrend = defineAsyncComponent\(\(\) => import\([^\n]+/, "const PortfolioHistoryTrend = { props: ['stats', 'range'], setup(props) { return () => testH('div', { historyStats: props.stats, historyRange: props.range }) } }")
    .replace(/import \{ initPortfolioHistory \} from ['"][^'"]+['"]/, 'const initPortfolioHistory = element => element.chart')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(`import { h as testH } from '${import.meta.resolve('vue')}';\n${source}`).toString('base64')}`)).default
  const previousDocument = globalThis.Document, previousShadow = globalThis.ShadowRoot
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', value: '', clientWidth: 600, clientHeight: 470, chart,
    get options() { return this.children.filter(child => child.tag === 'option') },
    addEventListener() {}, getRootNode: () => ({}), focus() { this.focused = true } })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), props = reactive(initial), componentRef = ref(null)
  const app = renderer.createApp({ setup() { if (store) providePortfolioLedger(store); return () => h(component, { ...props, ref: componentRef }) } })
  app.mount(host)
  await nextTick()
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, api: componentRef.value, unmount() { app.unmount(); globalThis.Document = previousDocument; globalThis.ShadowRoot = previousShadow },
    nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), field: name => all(host).find(n => n.props['aria-label'] === name),
    button: text => all(host).find(n => n.tag === 'button' && n.text === text),
    submit: () => all(host).find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }) }
}
function ledgerStore() {
  let id = 0
  return createPortfolioLedger({ storage: { getItem: () => null, setItem() {} }, id: () => `ui-${++id}` })
}

test('真实表单录入买卖、费用和分红，摘要重算，超卖与依赖删除拒绝，编辑及撤销保持账本一致', async () => {
  const store = ledgerStore(), view = await mount('PortfolioLedger', { market: { latest: { date: '2026-09-30', close: 1.2 } } }, store)
  const field = (name, value) => view.field(name).props['onUpdate:modelValue'](value)
  try {
    assert.match(view.text(), /还没有交易记录/)
    await view.api.newEntry('buy')
    field('账本日期', '2025-09-30'); field('账本成交份额', 1000); field('账本成交价', 1); field('账本费用', 5); field('账本备注', '<img src=x> 测试')
    await nextTick(); view.submit(); await nextTick()
    assert.equal(store.entries.value.length, 1); assert.match(view.text(), /1,005.00/); assert.match(view.text(), /19.40%/)
    assert.ok(!view.nodes().some(n => n.tag === 'img')); assert.match(view.text(), /<img src=x>/)
    await view.api.newEntry('sell'); field('账本成交份额', 1001); field('账本成交价', 1.2)
    view.submit(); await nextTick(); assert.match(view.text(), /超过当时持仓/); assert.equal(store.entries.value.length, 1)
    field('账本成交份额', 500); field('账本费用', 2); view.submit(); await nextTick()
    assert.equal(store.entries.value.length, 2); assert.match(view.text(), /95.50/)
    await view.api.newEntry('dividend'); field('账本现金金额', 20); field('账本费用', 1); view.submit(); await nextTick()
    assert.equal(store.entries.value.at(-1).sequence, 2); assert.match(view.text(), /19.00/)
    await view.api.newEntry('fee'); field('账本现金金额', 3); view.submit(); await nextTick()
    assert.equal(store.entries.value.at(-1).sequence, 3); assert.match(view.text(), /209.00/)
    view.field('删除交易 ui-1').props.onClick(); await nextTick()
    assert.match(view.text(), /删除未执行/); assert.equal(store.entries.value.length, 4)
    store.select('ui-1'); await nextTick(); assert.match(view.text(), /编辑记录/)
    assert.equal(view.field('账本成交价').value, 1)
    field('账本成交价', 1.1); view.submit(); await nextTick()
    assert.equal(store.entries.value[0].price, 1.1); assert.match(view.text(), /109.00/)
    view.field('删除交易 ui-4').props.onClick(); await nextTick(); assert.equal(store.entries.value.length, 3)
    view.button('撤销最近一次删除').props.onClick(); await nextTick(); assert.equal(store.entries.value.length, 4)
    view.props.error = '网络失败'; view.props.sourceNotice = '数据较旧'; await nextTick()
    assert.match(view.text(), /暂按原行情估值/); assert.match(view.text(), /数据较旧/); assert.match(view.text(), /109.00/)
    view.props.market = { latest: { date: '2025-09-30', close: 1.2 } }; await nextTick(); assert.match(view.text(), /最新记录晚于行情/)
  } finally { view.unmount() }
})

test('文件导入损坏或超限不改变账本，成功合并可重试，表单金额与编辑选择不串状态', async () => {
  const store = ledgerStore(), view = await mount('PortfolioLedger', {}, store)
  try {
    const input = view.field('选择账本备份文件')
    const invalid = { files: [{ size: 5, text: async () => '{bad' }], value: 'file' }
    await input.props.onChange({ target: invalid }); await nextTick()
    assert.match(view.text(), /导入未执行/); assert.equal(invalid.value, ''); assert.equal(store.entries.value.length, 0)
    const huge = { files: [{ size: 4 * 1024 * 1024 + 1, text() { throw new Error('must not read') } }], value: 'huge' }
    await input.props.onChange({ target: huge }); await nextTick(); assert.match(view.text(), /4 MB/)
    const valid = { files: [{ size: 200, text: async () => store.exportBackup() }], value: 'valid' }
    await input.props.onChange({ target: valid }); await nextTick(); assert.match(view.text(), /备份已合并/)
    assert.ok(!view.text().includes('导入未执行')); assert.equal(valid.value, '')
  } finally { view.unmount() }
})

test('历史曲线随买卖编辑删除与撤销重算，区间不重置累计金额，缺日与读取失败保留记账和原行情', async () => {
  const store = ledgerStore()
  const rows = [{ date: '2025-09-30', close: 1 }, { date: '2026-09-28', close: 1.1 }, { date: '2026-09-29', close: 1.2 }, { date: '2026-09-30', close: 1.3 }]
  const market = { code: '512890', source: 'eastmoney', interval: '1d', history: rows, latest: rows.at(-1) }
  const view = await mount('PortfolioLedger', { market }, store)
  const field = (name, value) => view.field(name).props['onUpdate:modelValue'](value)
  const stats = () => view.nodes().find(node => node.props.historyStats)?.props.historyStats
  try {
    assert.match(view.text(), /录入第一笔实际记录后/); assert.equal(stats(), undefined)
    await view.api.newEntry('buy'); field('账本日期', '2025-09-30'); field('账本成交份额', 100); field('账本成交价', 1); field('账本费用', 1)
    view.submit(); await nextTick()
    assert.equal(stats().points.at(-1).totalProfit, 29); assert.match(view.text(), /保留断点/)
    view.button('年初至今').props.onClick(); await nextTick()
    assert.ok(stats().points[0].date >= '2026-01-01'); assert.equal(stats().points[0].invested, 101)
    assert.equal(view.button('年初至今').props['aria-pressed'], true)
    store.select('ui-1'); await nextTick(); field('账本成交价', 1.1); view.submit(); await nextTick()
    assert.equal(stats().points.at(-1).totalProfit, 19); assert.equal(stats().points[0].invested, 111)
    await view.api.newEntry('dividend'); field('账本现金金额', 10); field('账本费用', 1); view.submit(); await nextTick()
    assert.equal(stats().points.at(-1).dividends, 9); assert.equal(stats().points.at(-1).totalProfit, 28)
    view.field('删除交易 ui-2').props.onClick(); await nextTick(); assert.equal(stats().points.at(-1).totalProfit, 19)
    view.button('撤销最近一次删除').props.onClick(); await nextTick(); assert.equal(stats().points.at(-1).totalProfit, 28)
    const original = stats()
    view.props.error = 'offline'; await nextTick(); assert.deepEqual(stats(), original); assert.match(view.text(), /暂按原行情估值/)
    view.props.market = null; view.props.loading = true; await nextTick()
    assert.match(view.text(), /正在读取历史行情/); assert.equal(stats(), undefined)
    view.props.market = market; view.props.loading = false; await nextTick(); assert.deepEqual(stats(), original)
    const details = view.nodes().find(node => node.tag === 'details' && node.props.class === 'ledger-history-details')
    details.props.onToggle({ target: { open: true } }); await nextTick(); assert.match(view.text(), /当日全部记录按同日顺序/)
    view.field('删除交易 ui-2').props.onClick(); await nextTick()
    view.field('删除交易 ui-1').props.onClick(); await nextTick()
    assert.equal(stats(), undefined); assert.equal(view.button('导出收益历史 CSV').props.disabled, true)
  } finally { view.unmount() }
})

test('交易 SVG 标记按可视网格裁剪、缩放后重投影，并支持键盘打开实际记录', async () => {
  const previousObserver = globalThis.ResizeObserver
  let disconnected = false, selected = null
  globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected = true } }
  const trade = (id, type, point) => ({ id, type, point, label: type === 'buy' ? '买' : '卖', title: `${id}真实成交`, entries: [{ id }] })
  const view = await mount('kline/KLineTradesOverlay', { trades: [trade('buy', 'buy', { x: 100, y: 100 }), trade('sell', 'sell', { x: 200, y: 50 }), trade('outside', 'buy', { x: 2, y: 100 })],
    layout: { left: 40, right: 20, priceTop: 30, priceHeight: 200 }, revision: 1, pointToPixel: point => point, onSelect: id => { selected = id } })
  try {
    assert.deepEqual(view.api.visibleTrades().map(trade => trade.id), ['buy', 'sell'])
    const marker = view.nodes().find(n => n.props['aria-label'] === '真实交易 buy真实成交')
    marker.props.onKeydown[0]({ key: 'Enter', preventDefault() {} }); assert.equal(selected, 'buy')
    view.props.pointToPixel = point => ({ ...point, x: point.x + 650 }); view.props.revision++; await nextTick()
    assert.equal(view.api.visibleTrades().length, 0)
  } finally { view.unmount(); globalThis.ResizeObserver = previousObserver }
  assert.equal(disconnected, true)
})

test('历史图隐藏更新后绘制最新输入，保留日期缩放与图例选择，切换区间重置缩放，卸载释放资源', async () => {
  const previousObserver = globalThis.ResizeObserver
  let notify, option, disconnected = false, disposed = false
  const options = []
  const chart = { getOption: () => option, setOption(value) { option = value; options.push(value) }, resize() {}, dispose() { disposed = true } }
  globalThis.ResizeObserver = class { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  const store = ledgerStore()
  store.upsert({ type: 'buy', date: '2026-09-28', sequence: 1, quantity: 100, price: 1, fee: 1, amount: null, ratio: null, note: '' })
  const rows = [{ date: '2026-09-28', close: 1 }, { date: '2026-09-29', close: 1.1 }, { date: '2026-09-30', close: 1.2 }]
  const stats = quotes => calculatePortfolioHistory(store.entries.value, { code: '512890', source: 'eastmoney', interval: '1d', history: quotes, latest: quotes.at(-1) })
  let view
  try {
    view = await mount('PortfolioHistoryTrend', { stats: stats(rows.slice(0, 2)), range: 'all' }, null, chart)
    assert.equal(options.length, 1)
    option = { dataZoom: [{ start: 100, end: 100 }], legend: [{ selected: { '持仓市值': false } }, { selected: { '费用影响（已计入盈亏）': false } }] }
    const canvas = view.nodes().find(node => node.props.class === 'portfolio-history-canvas')
    canvas.clientWidth = 0
    view.props.stats = stats(rows); await nextTick(); assert.equal(options.length, 1)
    canvas.clientWidth = 600; notify()
    assert.equal(options.length, 2); assert.equal(option.dataZoom[0].startValue, 1)
    assert.equal(option.legend[0].selected['持仓市值'], false); assert.equal(option.legend[1].selected['费用影响（已计入盈亏）'], false)
    view.props.range = 'ytd'; await nextTick(); assert.equal(option.dataZoom[0].startValue, 0)
    assert.equal(options.length, 3); notify(); assert.equal(options.length, 3)
  } finally { view?.unmount(); globalThis.ResizeObserver = previousObserver }
  assert.equal(disconnected, true); assert.equal(disposed, true); notify(); assert.equal(options.length, 3)
})
