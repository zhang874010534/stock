import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
const read = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
async function mount(dashboard, download) {
  const previous = { Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot, download: globalThis.qualityDownload }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}; globalThis.qualityDownload = download
  const file = new URL('../src/components/DividendQualityAnalysis.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'quality-component-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/import \{ downloadBlob \} from ['"][^'"]+['"]/, 'const downloadBlob = (...args) => globalThis.qualityDownload(...args)')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}), get options() { return this.children.filter(n => n.tag === 'option') } })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const host = node('host'), props = reactive({ instrument: '512890' })
  const app = renderer.createApp({ setup() { provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), field: name => all(host).find(n => n.props['aria-label'] === name), button: name => all(host).find(n => n.props['aria-label'] === name || n.tag === 'button' && n.text === name),
    unmount() { app.unmount(); globalThis.Document = previous.Document; globalThis.ShadowRoot = previous.ShadowRoot; globalThis.qualityDownload = previous.download } }
}
const setup = async extra => { const data = await read('fundamentals-h30269'), members = await read('constituents-h30269'); return { data, members, dashboard: createDashboardData({ fundamentals: async () => data, constituents: async () => members, ...extra }) } }
const select = async (view, name, value) => { view.field(name).props['onUpdate:modelValue'](value); await nextTick() }
const stockCount = view => view.nodes().filter(n => n.props['aria-label']?.startsWith('查看') && n.props['aria-label']?.endsWith('年度分红基本面')).length

test('quality view filters by fiscal year, industry, coverage and search; annual detail retains source times and CSV missing cells', async () => {
  const { data, dashboard } = await setup()
  let blob, filename
  const view = await mount(dashboard, (value, name) => { blob = value; filename = name })
  try {
    await flush()
    assert.equal(stockCount(view), 50)
    assert.match(view.text(), /非基金实际持仓/); assert.match(view.text(), /2021 — 2025/)
    assert.match(view.text(), /不代表每股分红增长、指数权重贡献/)
    await select(view, '分红质量筛选', 'decrease')
    assert.equal(stockCount(view), 13)
    await select(view, '分红质量筛选', 'cash')
    assert.equal(stockCount(view), 2); assert.match(view.text(), /三维化学/)
    await select(view, '分红质量筛选', 'all')
    view.button('筛选分红行业：金融').props.onClick(); await nextTick(); assert.equal(stockCount(view), 22)
    view.button('查看全部行业').props.onClick(); await nextTick()
    await select(view, '搜索分红分析股票代码或名称', '600938')
    assert.equal(stockCount(view), 1)
    view.button('查看中国海油年度分红基本面').props.onClick(); await nextTick()
    assert.match(view.text(), /至少 4 年（更早年度缺失）/)
    assert.match(view.text(), /2021 · 缺失/)
    assert.match(view.text(), /分红最近成功/); assert.match(view.text(), /财务最近成功/)
    await select(view, '分红分析财年', 2021)
    view.button('导出分红基本面 CSV').props.onClick(); await nextTick()
    assert.match(filename, /H30269_分红基本面_2021.csv/)
    const csv = await blob.text(); assert.match(csv, /"600938","中国海油"/); assert.match(csv, /"2021","",/)
    assert.match(view.text(), /当前筛选结果 CSV 已生成/)
    const signed = structuredClone(data), stock = signed.members.find(row => row.code === '600938')
    stock.financials.history.at(-1).operatingCashFlow = -123
    stock.name = '=SOURCE_TEXT'
    dashboard.states.fundamentals.data = signed; await nextTick()
    await select(view, '分红分析财年', 2025)
    view.button('导出分红基本面 CSV').props.onClick(); await nextTick()
    const protectedCsv = await blob.text()
    assert.match(protectedCsv, /"-123"/); assert.ok(!protectedCsv.includes("'-123"))
    assert.match(protectedCsv, /"'=SOURCE_TEXT"/)
    await select(view, '搜索分红分析股票代码或名称', 'not-found')
    assert.equal(stockCount(view), 0); assert.match(view.text(), /没有匹配的股票/)
    view.props.instrument = 'H30269'; await nextTick(); assert.ok(!view.text().includes('非基金实际持仓'))
    assert.equal(data.members.length, 50)
  } finally { view.unmount() }
})

test('quality refresh preserves the last complete group on failure, recovers, warns on mismatched cohort and keeps per-source stale dates', async () => {
  const data = await read('fundamentals-h30269'), members = await read('constituents-h30269'); let fail = '', version = 1
  const updated = structuredClone(data)
  updated.members[0].dividends.history.at(-1).cashDividend *= 2; updated.members[0].dividends.history.at(-1).plannedDividend *= 2
  const dashboard = createDashboardData({ fundamentals: async () => { if (fail === 'fundamentals') throw new Error('offline'); return version === 1 ? data : updated }, constituents: async () => { if (fail === 'constituents') throw new Error('members offline'); return members } })
  const view = await mount(dashboard)
  try {
    await flush()
    view.button('查看平安银行年度分红基本面').props.onClick(); await nextTick()
    const historyBefore = view.text().slice(view.text().indexOf('个股年度历史'))
    version = 2; fail = 'constituents'
    await dashboard.refresh(['fundamentals']); await flush()
    assert.match(view.text(), /保留原分析和名单日期/); assert.match(view.text(), /members offline/)
    assert.equal(view.text().slice(view.text().indexOf('个股年度历史')), historyBefore)
    fail = ''; await dashboard.refresh(['fundamentals']); await flush()
    assert.ok(!view.text().includes('文件读取失败'))
    assert.notEqual(view.text().slice(view.text().indexOf('个股年度历史')), historyBefore)
    const mismatch = structuredClone(members); mismatch.members[0].name = '名单修订'
    dashboard.states.constituents.data = mismatch; await nextTick()
    assert.match(view.text(), /不将旧基本面套用到新成员/)
    const stale = structuredClone(updated); stale.status = 'partial'; stale.reason = 'one failed'; stale.members[0].dividends.status = 'stale'; stale.members[0].dividends.reason = 'provider offline'
    dashboard.states.fundamentals.data = stale; await nextTick()
    assert.match(view.text(), /1 个个股来源使用保留值/); assert.match(view.text(), /provider offline/)
  } finally { view.unmount() }
})

test('first failed snapshot produces unavailable text, with no invented amount or coverage summary', async () => {
  const { dashboard } = await setup({ fundamentals: async () => { throw new Error('missing file') } })
  const view = await mount(dashboard)
  try { await flush(); assert.match(view.text(), /尚无分红与基本面快照/); assert.match(view.text(), /missing file/); assert.equal(stockCount(view), 0); assert.ok(!view.text().includes('0.00 亿')) }
  finally { view.unmount() }
})

test('used fundamentals, membership and industry history refresh together with shared requests', async () => {
  const keys = ['fundamentals', 'constituents', 'constituentHistory'], calls = {}
  const dashboard = createDashboardData(Object.fromEntries(keys.map(key => [key, async () => { calls[key] = (calls[key] ?? 0) + 1; return {} }])))
  await Promise.all(keys.map(dashboard.ensure))
  await Promise.all([dashboard.refresh(['fundamentals']), dashboard.refresh(['constituentHistory'])])
  assert.ok(keys.every(key => calls[key] === 2))
})
