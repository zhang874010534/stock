import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { createObservationNotes, provideObservationNotes } from '../src/composables/useObservationNotes.js'
import { REVIEWS_KEY } from '../src/utils/reviewSummary.js'
import { tradingSessions } from '../src/utils/priceRisk.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'

const NativeDate = Date, now = () => new NativeDate('2026-10-02T08:00:00.000Z')
const memoryStorage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } }
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick() } }
function market(code = '512890', lastPrice = 1.1) {
  const history = tradingSessions('2026-04-01', '2026-09-30', tradingCalendar).map(date => { const close = date === '2026-09-30' ? lastPrice : 1; return { date, open: close, close, high: close, low: close } })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: now().toISOString(), backfill: { completed: false }, history, latest: history.at(-1) }
}
function loaders(overrides = {}) {
  return { '512890': () => market(), H30269: () => market('H30269'),
    eastmoneyHistory: () => ({ schemaVersion: 1, code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE, basis: 'provider_unspecified', unit: 'multiple', date: '2026-09-30', history: [{ date: '2026-08-31', pe: 8, pb: .8 }, { date: '2026-09-30', pe: 8.5, pb: .85 }] }),
    constituentHistory: () => { throw new Error('unavailable') }, collection: () => ({ sources: { '512890': { status: 'ok' }, H30269: { status: 'ok' }, valuation: { status: 'ok' } } }), ...overrides }
}
async function mount(dashboard, storage = memoryStorage(), notes) {
  const previous = Object.fromEntries(['Date', 'Document', 'ShadowRoot', 'localStorage', 'document'].map(key => [key, globalThis[key]]))
  const originalCreateUrl = URL.createObjectURL, originalRevokeUrl = URL.revokeObjectURL
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now().toISOString()])) } static now() { return now().getTime() } }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}; globalThis.localStorage = storage
  const downloads = [], blobs = [], drawn = []
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:review-test' }; URL.revokeObjectURL = () => {}
  globalThis.document = { body: { append() {} }, createElement: tag => tag === 'canvas' ? { getContext: () => ({ measureText: text => ({ width: text.length * 10 }), fillRect() {}, fillText: text => drawn.push(text) }), toBlob: done => done(new Blob(['png'], { type: 'image/png' })) } : { click() { downloads.push(this.download) }, remove() {} } }
  const file = new URL('../src/components/ReviewSummary.vue', import.meta.url), { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'review-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content.replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}), get options() { return this.children.filter(child => child.tag === 'option') } })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp(n, key, old, value) { n.props[key] = value; if (key === 'value') n.value = n._value = value } })
  const props = reactive({ instrument: '512890' }), host = node('host')
  const app = renderer.createApp({ setup() { provideDashboardData(dashboard); provideObservationNotes(notes ?? createObservationNotes({ storage })); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, storage, downloads, blobs, drawn, text: () => all(host).map(n => n.text).join(' '), nodes: () => all(host), field: label => all(host).find(n => n.props['aria-label'] === label), button: text => all(host).find(n => n.tag === 'button' && n.text === text),
    unmount() { app.unmount(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl } }
}
async function generateMonth(view) {
  view.field('复盘周期').props['onUpdate:modelValue']('month'); await nextTick()
  view.field('复盘月份').props['onUpdate:modelValue']('2026-09')
  view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await nextTick()
}

test('页面生成周月摘要、感想、笔记和导出，保存后编辑笔记与刷新不改变历史，另存版本保留旧稿', async () => {
  const storage = memoryStorage(), notes = createObservationNotes({ storage, now, id: () => 'my-note' })
  notes.upsert({ instrument: '512890', date: '2026-09-26', price: null, text: '<img src=x> 我的周末观察\n完整第二行' })
  let lastPrice = 1.1
  const dashboard = createDashboardData(loaders({ '512890': () => market('512890', lastPrice) }))
  let view = await mount(dashboard, storage, notes)
  try {
    await flush(); assert.match(view.text(), /选择周期并点击/); await generateMonth(view)
    assert.match(view.text(), /每月复盘.*2026-09-01 — 2026-09-30/); assert.match(view.text(), /\+10.00 %/)
    assert.match(view.text(), /我的周末观察/); assert.ok(!view.nodes().some(node => node.tag === 'img'))
    assert.match(view.text(), /成分历史读取失败/)
    assert.ok(!view.text().includes('个人笔记状态：笔记已保存'))
    view.field('复盘感想').props['onUpdate:modelValue']('继续观察风险'); await nextTick()
    view.button('保存本次复盘').props.onClick(); await nextTick()
    let saved = JSON.parse(storage.getItem(REVIEWS_KEY)).reviews[0]
    assert.equal(saved.reflection, '继续观察风险'); assert.equal(saved.notes[0].text, '<img src=x> 我的周末观察\n完整第二行')
    const reportId = saved.id
    notes.upsert({ id: 'my-note', instrument: '512890', date: '2026-09-26', price: null, text: '后来修改的笔记' })
    lastPrice = 1.2; await dashboard.refresh(['512890']); await flush()
    assert.match(view.text(), /我的周末观察/); assert.match(view.text(), /\+10.00 %/)
    await view.button('导出 Markdown').props.onClick(); await nextTick()
    assert.equal(view.downloads[0], '512890_月复盘_2026-09-01_2026-09-30.md')
    assert.match(await view.blobs[0].text(), /完整第二行/)
    await view.button('导出复盘图片').props.onClick(); await nextTick()
    assert.ok(view.downloads.at(-1).endsWith('.png')); assert.ok(view.drawn.includes('完整第二行'))
    view.button('另存修改版本').props.onClick(); await nextTick(); view.field('复盘感想').props['onUpdate:modelValue']('新的感想'); await nextTick()
    view.button('保存本次复盘').props.onClick(); await nextTick()
    assert.equal(JSON.parse(storage.getItem(REVIEWS_KEY)).reviews.length, 2)
    assert.equal(JSON.parse(storage.getItem(REVIEWS_KEY)).reviews[1].reflection, '继续观察风险')
    view.field('查看已保存复盘').props['onUpdate:modelValue'](reportId); await nextTick()
    assert.match(view.text(), /继续观察风险/)
    view.button('删除这份复盘').props.onClick(); await nextTick()
    view.button('撤销删除复盘').props.onClick(); await nextTick()
    assert.equal(JSON.parse(storage.getItem(REVIEWS_KEY)).reviews.length, 2)
    view.unmount(); view = await mount(createDashboardData(loaders()), storage); await flush()
    view.field('查看已保存复盘').props['onUpdate:modelValue'](reportId); await nextTick()
    assert.match(view.text(), /我的周末观察/); assert.match(view.text(), /继续观察风险/)
    view.props.instrument = 'H30269'; await flush()
    assert.ok(!view.text().includes('我的周末观察')); assert.match(view.text(), /历史复盘（0/)
  } finally { view.unmount() }
})

test('失败来源仍汇总可核验项目，缺失行情不伪造收益；禁止保存、无效日期和过长感想清楚提示', async () => {
  const dashboard = createDashboardData(loaders({ '512890': () => { throw new Error('offline') } }))
  const view = await mount(dashboard, { getItem: () => null, setItem() { throw new Error('quota') } })
  try {
    await flush(); await generateMonth(view)
    assert.match(view.text(), /行情读取失败/); assert.match(view.text(), /512890 行情文件格式异常/)
    assert.match(view.text(), /\+0.50 倍/); assert.ok(!view.text().includes('+10.00 %'))
    view.button('保存本次复盘').props.onClick(); await nextTick(); assert.match(view.text(), /保存失败/)
    view.field('复盘月份').props['onUpdate:modelValue']('2026-11')
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await nextTick(); assert.match(view.text(), /未来周期/)
    view.field('复盘月份').props['onUpdate:modelValue']('2026-09')
    view.button('另存修改版本').props.onClick(); await nextTick(); view.field('复盘感想').props['onUpdate:modelValue']('字'.repeat(4001)); await nextTick()
    view.button('保存本次复盘').props.onClick(); await nextTick(); assert.match(view.text(), /最多 4000 字/)
  } finally { view.unmount() }
})
