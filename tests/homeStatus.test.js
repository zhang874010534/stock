import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, reactive, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'

// Render Home with lightweight child stubs; exercise its actual API requests,
// source selection, summary and card slots without requiring a canvas/browser.
async function mountHome(realOverview = false) {
  const realComponents = new Map()
  if (realOverview) for (const name of ['TodayOverview', 'ObservationAlerts']) {
    const componentFile = new URL(`../src/components/${name}.vue`, import.meta.url)
    const { descriptor } = parse(await readFile(componentFile, 'utf8'))
    const content = compileScript(descriptor, { id: `home-${name}`, inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
      .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, componentFile).href : import.meta.resolve(specifier)}'`)
    realComponents.set(name, `data:text/javascript;base64,${Buffer.from(content).toString('base64')}`)
  }
  const file = new URL('../src/views/Home.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  let script = compileScript(descriptor, { id: 'home-status-test', inlineTemplate: true }).content
  script = script.replace(/import (\w+) from ['"]([^'"]+\.vue)['"]/g, (_, name) => realComponents.has(name) ? `import ${name} from '${realComponents.get(name)}'` : `const ${name} = { setup(props, { slots, expose }) {
    let opened = false;
    expose({ loading: false, error: false, hasWarning: false, asOf: '2026-09-17', refresh: async () => {}, openConstituents: () => { opened = true; } });
    return () => testH('div', { 'data-component': '${name}', onCheckOpened: () => opened }, [slots['value-detail']?.(), slots.default?.()]);
  } }`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)}'`)
  script = `import { h as testH } from '${import.meta.resolve('vue')}';\n${script}`
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}),
    focus() { this.focused = true }, setAttribute(key, value) { this.props[key] = value },
    get options() { return this.children.filter(n => n.tag === 'option') } })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const props = reactive({ instrument: '512890' }), host = node('host')
  const app = renderer.createApp({ render: () => h(component, props) })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { app, props, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), refresh: () => all(host).find(n => n.props.class === 'refresh-button').props.onClick() }
}
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick() } }

test('首页真实概览与提醒模块同步触发、已读和证券切换，卡片导航转移焦点', async () => {
  const previous = Object.fromEntries(['fetch', 'document', 'Date', 'localStorage', 'Document', 'ShadowRoot'].map(key => [key, globalThis[key]]))
  const NativeDate = Date, memory = new Map()
  let mounted
  try {
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-10-02T08:00:00Z'])) } static now() { return NativeDate.parse('2026-10-02T08:00:00Z') } }
    globalThis.Document = class {}; globalThis.ShadowRoot = class {}
    globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) }
    globalThis.document = { title: '', getElementById: id => mounted?.nodes().find(n => n.props.id === id) }
    const names = ['512890', 'h30269', 'valuation-h30269', 'dividend-h30269', 'china-bond-10y', 'dashboard-source-status']
    const snapshots = Object.fromEntries(await Promise.all(names.map(async name => [name, JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))])))
    globalThis.fetch = async url => Response.json(snapshots[url.split('/').at(-1).split('.json')[0]])
    mounted = await mountHome(true); await flush()
    const button = label => mounted.nodes().find(n => n.tag === 'button' && n.text === label)
    const field = label => mounted.nodes().find(n => n.props['aria-label'] === label)
    const overview = () => mounted.nodes().find(n => n.props.id === 'today-overview')
    const all = n => [n, ...n.children.flatMap(all)]
    const alertCard = () => all(overview()).find(n => n.tag === 'a' && n.props.href === '#observation-alerts')
    const cardText = () => all(alertCard()).map(n => n.text).join(' ')
    assert.match(cardText(), /0 条.*尚未设置条件/)
    button('添加条件').props.onClick(); await nextTick()
    field('观察阈值').props['onUpdate:modelValue']('2')
    mounted.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await flush()
    assert.match(cardText(), /1 条.*1 条条件满足/)
    alertCard().props.onClick(); await flush()
    assert.equal(field('自定义观察提醒').focused, true)
    assert.match(cardText(), /1 条/)
    button('全部标为已读').props.onClick(); await flush()
    assert.match(cardText(), /0 条.*1 条条件满足/)
    mounted.props.instrument = 'H30269'; await flush()
    assert.match(cardText(), /0 条.*尚未设置条件/)
    assert.ok(!all(overview()).some(n => n.tag === 'a' && n.props.href === '#portfolio-ledger'))
    mounted.props.instrument = '512890'; await flush()
    assert.match(cardText(), /0 条.*1 条条件满足/)
    assert.equal(JSON.parse(memory.get('stock:observation-alerts:v1')).events.length, 1)
  } finally {
    mounted?.app.unmount()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
  }
})

test('homepage separates readable snapshots, source failure, unknown status and instrument identity', async () => {
  const previousFetch = globalThis.fetch, previousDocument = globalThis.document
  let mounted, statusUnavailable = false
  const ok = { status: 'ok', lastAttemptAt: '2026-09-27T08:00:00Z', lastSuccessAt: '2026-09-27T08:00:00Z', error: null }
  const sources = Object.fromEntries(['H30269', '512890', '000300', 'valuation', 'dividend', 'bond'].map(key => [key, { ...ok }]))
  sources['512890'] = { ...ok, status: 'error', error: 'ETF 来源失败' }
  const snapshots = Object.fromEntries(await Promise.all(['512890', 'h30269', 'valuation-h30269', 'dividend-h30269', 'china-bond-10y'].map(async name => [name, JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))])))
  try {
    globalThis.document = { title: '' }
    globalThis.fetch = async url => {
      if (url.includes('dashboard-source-status')) return statusUnavailable ? new Response('', { status: 503 }) : Response.json({ schemaVersion: 1, sources })
      const name = url.split('/').at(-1).split('.json')[0]
      return Response.json(snapshots[name])
    }
    mounted = await mountHome()
    await flush()
    assert.ok(mounted.nodes().some(n => n.props['data-component'] === 'EtfNavAnalysis'))
    assert.ok(mounted.nodes().some(n => n.props['data-component'] === 'DividendQualityAnalysis'))
    assert.match(mounted.text(), /部分后台更新失败/)
    assert.match(mounted.text(), /后台更新失败，显示已保存数据/)
    assert.match(mounted.text(), /ETF 来源失败/)
    assert.ok(!mounted.text().includes('部分文件读取失败'))
    mounted.props.instrument = 'H30269'
    await flush()
    assert.ok(!mounted.nodes().some(n => n.props['data-component'] === 'EtfNavAnalysis'))
    assert.ok(mounted.nodes().some(n => n.props['data-component'] === 'DividendQualityAnalysis'))
    assert.ok(!mounted.text().includes('部分后台更新失败'))
    assert.ok(!mounted.text().includes('ETF 来源失败'))
    mounted.props.instrument = '512890'
    await flush()
    statusUnavailable = true
    await mounted.refresh(); await flush()
    assert.match(mounted.text(), /部分后台采集状态未知/)
    assert.match(mounted.text(), /部分后台更新失败/)
    assert.match(mounted.text(), /当前状态未能重新核验/)
    statusUnavailable = false
    sources['512890'] = { ...ok }
    await mounted.refresh(); await flush()
    assert.ok(!mounted.text().includes('部分后台更新失败'))
    assert.ok(!mounted.text().includes('部分后台采集状态未知'))
    mounted.app.unmount(); mounted = null
    statusUnavailable = true
    mounted = await mountHome(); await flush()
    assert.match(mounted.text(), /后台采集状态未知/)
    assert.ok(!mounted.text().includes('最近一次后台采集成功'))
  } finally { mounted?.app.unmount(); globalThis.fetch = previousFetch; globalThis.document = previousDocument }
})

test('homepage summary follows the selected instrument, retains values on failure and opens constituents', async () => {
  const previousFetch = globalThis.fetch, previousDocument = globalThis.document
  let mounted, failMarket = false
  const names = ['512890', 'h30269', 'valuation-h30269', 'dividend-h30269', 'china-bond-10y', 'dashboard-source-status']
  const snapshots = Object.fromEntries(await Promise.all(names.map(async name => [name,
    JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8')),
  ])))
  for (const [name, prices] of [['512890', [1, 1.1, 1.111]], ['h30269', [100, 100, 99]]]) {
    snapshots[name].history = ['2025-12-31', '2026-01-05', '2026-01-06'].map((date, i) => ({
      date, open: prices[i], close: prices[i], high: prices[i], low: prices[i],
    }))
    snapshots[name].latest = snapshots[name].history.at(-1)
  }
  try {
    globalThis.document = { title: '' }
    globalThis.fetch = async url => {
      const name = url.split('/').at(-1).split('.json')[0]
      if (failMarket && ['512890', 'h30269'].includes(name)) return new Response('', { status: 503 })
      return Response.json(snapshots[name])
    }
    mounted = await mountHome(); await flush()
    assert.match(mounted.text(), /\+0.011 元/)
    assert.match(mounted.text(), /\+1.00%/)
    assert.match(mounted.text(), /2026 年初至今/)
    assert.match(mounted.text(), /\+11.10%/)
    assert.match(mounted.text(), /2025-12-31/)
    assert.match(mounted.text(), /ETF 未复权/)
    const drawdown = () => mounted.nodes().find(n => n.props['data-component'] === 'DrawdownAnalysis')
    assert.equal(drawdown().props.instrument, '512890')
    assert.deepEqual(drawdown().props.history, snapshots['512890'].history)
    const entry = mounted.nodes().find(n => n.props.class === 'refresh-button constituents-button')
    entry.props.onClick()
    assert.equal(mounted.nodes().find(n => n.props['data-component'] === 'IndexChart').props.onCheckOpened(), true)
    mounted.props.instrument = 'H30269'; await flush()
    assert.match(mounted.text(), /-1.00 点/)
    assert.match(mounted.text(), /-1.00%/)
    assert.ok(!mounted.text().includes('+11.10%'))
    assert.equal(drawdown().props.instrument, 'H30269')
    assert.deepEqual(drawdown().props.history, snapshots.h30269.history)
    failMarket = true
    await mounted.refresh(); await flush()
    assert.match(mounted.text(), /-1.00 点/)
    assert.match(mounted.text(), /读取失败，保留上次数据/)
    assert.match(mounted.text(), /2026-01-06/)
    assert.ok(drawdown().props.error)
    assert.deepEqual(drawdown().props.history, snapshots.h30269.history)
  } finally { mounted?.app.unmount(); globalThis.fetch = previousFetch; globalThis.document = previousDocument }
})
