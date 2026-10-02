import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { createPortfolioLedger, providePortfolioLedger } from '../src/composables/usePortfolioLedger.js'

const NativeDate = Date, now = () => new NativeDate('2026-10-02T08:00:00Z')
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick() } }
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } }
function market(code = '512890', price = 1.2) {
  const history = ['2026-09-29', '2026-09-30'].map((date, i) => {
    const close = i ? price : 1
    return { date, open: close, close, high: close, low: close }
  })
  return { code, source: 'eastmoney', interval: '1d', history, latest: history.at(-1), updatedAt: now().toISOString(), backfill: { completed: true } }
}
async function mount(dashboard, ledger) {
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now().toISOString()])) } }
  const file = new URL('../src/components/TodayOverview.vue', import.meta.url), { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'overview-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, props: {}, children: [], text: '', open: false })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value } })
  const navigated = [], props = reactive({ instrument: '512890', alerts: { unreadCount: 0, ruleCount: 0, activeCount: 0, pendingCount: 0 } }), host = node('host')
  const app = renderer.createApp({ setup() { provideDashboardData(dashboard); providePortfolioLedger(ledger); return () => h(component, { ...props, onNavigate: target => navigated.push(target) }) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, navigated, text: () => all(host).map(n => n.text).join(' '), nodes: () => all(host),
    link: target => all(host).find(n => n.tag === 'a' && n.props.href === target),
    unmount() { app.unmount(); globalThis.Date = NativeDate } }
}

test('概览响应账本增改删除撤销、提醒已读、证券切换及详情导航', async () => {
  const dashboard = createDashboardData({ '512890': () => market(), H30269: () => market('H30269', .9),
    collection: () => ({ sources: { '512890': { status: 'ok' }, H30269: { status: 'ok' } } }) })
  await Promise.all(['512890', 'H30269', 'collection'].map(key => dashboard.ensure(key)))
  const ledger = createPortfolioLedger({ storage: storage(), now, id: () => 'buy' }), view = await mount(dashboard, ledger)
  const buy = { type: 'buy', date: '2026-09-29', sequence: 1, quantity: 100, price: 1, fee: 0, amount: null, ratio: null, note: '' }
  try {
    assert.match(view.text(), /今日与我有关/); assert.match(view.text(), /尚未录入账本/)
    ledger.upsert(buy); await nextTick(); assert.match(view.text(), /\+20.00 元/)
    ledger.upsert({ ...buy, id: 'buy', quantity: 200 }); await nextTick(); assert.match(view.text(), /\+40.00 元/)
    ledger.remove('buy'); await nextTick(); assert.match(view.text(), /尚未录入账本/)
    ledger.undoRemove(); await nextTick(); assert.match(view.text(), /\+40.00 元/)
    Object.assign(view.props.alerts, { unreadCount: 2, ruleCount: 3, activeCount: 1, pendingCount: 1 }); await nextTick()
    assert.match(view.text(), /2 条/); assert.match(view.text(), /1 条条件满足 · 1 条待核验/)
    for (const target of ['#market-chart', '#portfolio-ledger', '#observation-alerts', '#constituent-comparison']) view.link(target).props.onClick()
    assert.deepEqual(view.navigated, ['#market-chart', '#portfolio-ledger', '#observation-alerts', '#constituent-comparison'])
    assert.equal(view.props.alerts.unreadCount, 2) // Navigation never marks an event read.
    view.props.alerts.unreadCount = 0; await nextTick(); assert.match(view.link('#observation-alerts').children.map(n => n.text).join(' '), /0 条/)
    view.props.instrument = 'H30269'; await nextTick()
    assert.equal(view.link('#portfolio-ledger'), undefined); assert.match(view.text(), /指数观察/)
    assert.match(view.text(), /-10.00%/); assert.ok(!view.text().includes('+40.00 元'))
  } finally { view.unmount() }
})

test('失败保留概览值和日期，异常可展开并定位模块，未知状态不被正常读取清除', async () => {
  let fail = false, price = 1.2
  const dashboard = createDashboardData({ '512890': () => { if (fail) throw new Error('测试失败'); return market('512890', price) },
    collection: () => ({ sources: { '512890': { status: 'error' } } }) })
  await Promise.all(['512890', 'collection'].map(key => dashboard.ensure(key)))
  const view = await mount(dashboard, createPortfolioLedger({ storage: storage(), now }))
  try {
    view.link('#today-data-issues').props.onClick(); await nextTick()
    assert.equal(view.nodes().find(n => n.props.id === 'today-data-issues').open, true)
    assert.match(view.text(), /后台更新失败/)
    fail = true; await dashboard.refresh(['512890']); await flush()
    assert.match(view.text(), /\+20.00%/); assert.match(view.text(), /2026-09-29 → 2026-09-30/)
    assert.match(view.text(), /读取失败，保留原值与日期/)
    fail = false; price = 1.3; await dashboard.refresh(['512890']); await flush()
    assert.match(view.text(), /\+30.00%/); assert.ok(!view.text().includes('读取失败，保留原值与日期'))
    assert.match(view.text(), /后台更新失败/)
    dashboard.states.collection.data = null; dashboard.states.collection.error = '状态文件不可用'; await nextTick()
    assert.match(view.text(), /后台采集状态未知/)
    view.link('#data-source-status').props.onClick(); assert.equal(view.navigated.at(-1), '#data-source-status')
  } finally { view.unmount() }
})

test('本机账本读取失败出现在概览待核验明细，保留原存储', async () => {
  const memory = storage(); memory.setItem('stock:portfolio-ledger:v1', '{invalid')
  const ledger = createPortfolioLedger({ storage: memory, now }), dashboard = createDashboardData()
  const view = await mount(dashboard, ledger)
  try {
    assert.equal(ledger.hasWarning.value, true); assert.match(view.text(), /本机账本无法读取/)
    assert.equal(memory.getItem('stock:portfolio-ledger:v1'), '{invalid')
  } finally { view.unmount() }
})
