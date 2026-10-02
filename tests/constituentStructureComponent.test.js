import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createDashboardData, provideDashboardData } from '../src/composables/useDashboardData.js'
import { CONSTITUENTS_SOURCE } from '../src/api/constituents.js'
import { INDUSTRY_SOURCE, INDUSTRY_BASIS } from '../src/utils/constituentStructure.js'

async function mount(name, initial, dashboard) {
  const previousDocument = globalThis.Document, previousShadow = globalThis.ShadowRoot
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const file = new URL(`../src/components/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'structure-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace("import ConstituentWeights from './ConstituentWeights.vue'", 'const ConstituentWeights = { render: () => null }')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const node = tag => ({ tag, tagName: tag.toUpperCase(), children: [], props: {}, text: '', addEventListener() {}, removeEventListener() {}, getRootNode: () => ({}), get options() { return this.children.filter(n => n.tag === 'option') } })
  const renderer = createRenderer({ createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1) }, setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1], patchProp: (n, key, old, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value },
  })
  const host = node('host'), props = reactive(initial)
  const app = renderer.createApp({ setup() { provideDashboardData(dashboard); return () => h(component, props) } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, unmount: () => { app.unmount(); globalThis.Document = previousDocument; globalThis.ShadowRoot = previousShadow }, nodes: () => all(host), text: () => all(host).map(n => n.text).join(' '), button: label => all(host).find(n => n.tag === 'button' && n.text === label) }
}
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(done => setImmediate(done)); await nextTick() } }
function inputs(version = 1) {
  const original = Array.from({ length: 50 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `股票${i + 1}`, exchange: 'SZSE', industry: null, industryStatus: 'unavailable', industryDate: null, industryObservedAt: null, industrySourceIndex: null }))
  const members = original.map((item, i) => ({ ...item, ...(i < 45 ? { industry: i < 30 ? '金融' : '工业', industryStatus: 'ok', industryDate: '2026-09-28', industryObservedAt: '2026-09-28T10:00:00Z', industrySourceIndex: i < 30 ? '932083' : '932079' } : {}) }))
  if (version === 2) { members[49].code = '000099'; members[49].name = '新加入'; members[0].name = '新名称' }
  const history = { schemaVersion: 1, code: 'H30269', source: CONSTITUENTS_SOURCE, industrySource: INDUSTRY_SOURCE, industryBasis: INDUSTRY_BASIS, membershipStatus: 'ok', membershipReason: null, industryStatus: 'partial', industryReason: '5只未分类', lastAttemptAt: '2026-09-28T10:00:00Z',
    snapshots: [{ date: '2026-09-24', observedAt: '2026-09-24T10:00:00Z', members: original }, { date: '2026-09-28', observedAt: '2026-09-28T10:00:00Z', members }] }
  const current = { schemaVersion: 1, code: 'H30269', source: CONSTITUENTS_SOURCE, status: 'ok', reason: null, date: '2026-09-28', count: 50, members: members.map(({ code, name, exchange }) => ({ code, name, exchange })) }
  return { current, history }
}

test('区间选择按观察顺序校验，显示净新增移除及覆盖变化，并可定位两端名单', async () => {
  const data = inputs(2)
  const view = await mount('ConstituentStructure', { instrument: '512890' }, createDashboardData({ constituents: () => data.current, constituentHistory: () => data.history }))
  try {
    await flush(); assert.match(view.text(), /新增股票（1 只）/); assert.match(view.text(), /移除股票（1 只）/)
    assert.match(view.text(), /49 只/); assert.match(view.text(), /不能全部归因于调样/)
    const field = label => view.nodes().find(node => node.props['aria-label'] === label)
    const from = field('区间对比变更前观察'), to = field('区间对比变更后观察')
    from.props['onUpdate:modelValue'](data.history.snapshots[1].observedAt); from.props.onChange(); await nextTick()
    assert.match(view.text(), /变更前观察必须早于变更后观察/); assert.ok(!view.text().includes('新增股票（'))
    to.props['onUpdate:modelValue'](data.history.snapshots[0].observedAt); to.props.onChange(); await nextTick()
    assert.match(view.text(), /变更前观察必须早于变更后观察/)
    view.button('最近两次观察').props.onClick(); await nextTick(); assert.match(view.text(), /新增股票（1 只）/)
    view.button('打开区间变更前名单').props.onClick(); await nextTick(); assert.match(view.text(), /未保存行业分类/)
    view.button('打开区间变更后名单').props.onClick(); await nextTick(); assert.match(view.text(), /45 \/ 50/)
  } finally { view.unmount() }
})

test('仅看调入调出排除改名和行业观察变化，固定对比在新增观察后保留选择', async () => {
  const data = inputs(2)
  const next = structuredClone(data.history.snapshots[1]); next.date = '2026-09-29'; next.observedAt = '2026-09-29T10:00:00Z'
  next.members[1].name = '再次改名'; data.history.snapshots.push(next)
  const dashboard = createDashboardData({ constituents: () => data.current, constituentHistory: () => data.history })
  const view = await mount('ConstituentStructure', { instrument: 'H30269' }, dashboard)
  try {
    await flush(); assert.match(view.text(), /新增股票（0 只）/)
    const timeline = () => view.nodes().find(node => node.props['aria-label'] === '名单变化时间线')
    const texts = node => [node.text, ...node.children.map(texts)].join(' ')
    assert.match(texts(timeline()), /再次改名/)
    view.button('仅看调入调出').props.onClick(); await nextTick()
    assert.ok(!texts(timeline()).includes('再次改名')); assert.match(texts(timeline()), /调入 1 只/)
    const from = view.nodes().find(node => node.props['aria-label'] === '区间对比变更前观察')
    from.props['onUpdate:modelValue'](data.history.snapshots[0].observedAt); from.props.onChange(); await nextTick()
    const later = structuredClone(next); later.date = '2026-09-30'; later.observedAt = '2026-09-30T10:00:00Z'
    dashboard.states.constituentHistory.data = { ...data.history, snapshots: [...data.history.snapshots, later] }; await flush()
    const beforeSelect = view.nodes().find(node => node.props['aria-label'] === '区间对比变更前观察')
    const afterSelect = view.nodes().find(node => node.props['aria-label'] === '区间对比变更后观察')
    assert.equal(beforeSelect.options[beforeSelect.selectedIndex].value, data.history.snapshots[0].observedAt)
    assert.equal(afterSelect.options[afterSelect.selectedIndex].value, next.observedAt)
  } finally { view.unmount() }
})

test('行业筛选和搜索、历史选择及ETF标签正确；旧观察不使用当前分类，改名不算调入', async () => {
  const data = inputs(2)
  const dashboard = createDashboardData({ constituents: () => data.current, constituentHistory: () => data.history })
  const view = await mount('ConstituentStructure', { instrument: '512890' }, dashboard)
  try {
    await flush()
    assert.match(view.text(), /非 ETF 实际持仓/); assert.match(view.text(), /45 \/ 50/)
    assert.match(view.text(), /5 只未分类/); assert.match(view.text(), /名称更新：000001/)
    assert.match(view.text(), /调入 1 只/); assert.match(view.text(), /调出 1 只/)
    assert.match(view.text(), /最大已分类行业数量占比/); assert.match(view.text(), /60.0%/)
    assert.match(view.text(), /90.0%/); assert.match(view.text(), /实际 2 个行业/)
    assert.match(view.text(), /不能完整反映行业集中程度/)
    view.nodes().find(n => n.props['aria-label']?.startsWith('金融，')).props.onClick(); await nextTick()
    assert.match(view.text(), /30 \/ 50 只/)
    const search = view.nodes().find(n => n.tag === 'input')
    search.props['onUpdate:modelValue']('000001'); await nextTick()
    assert.match(view.text(), /1 \/ 50 只/)
    view.nodes().find(n => n.tag === 'select').props['onUpdate:modelValue']('2026-09-24T10:00:00Z'); await nextTick()
    assert.match(view.text(), /0 \/ 50/); assert.match(view.text(), /未保存行业分类，不用当前分类回填历史/)
    assert.match(view.text(), /尚无已分类股票/)
    view.button('查看变更后名单').props.onClick(); await nextTick()
    assert.equal(view.nodes().find(n => n.tag === 'select').selectedIndex, 1)
    assert.match(view.text(), /45 \/ 50/); assert.match(view.text(), /50 \/ 50 只/)
    view.button('查看变更前名单').props.onClick(); await nextTick()
    assert.equal(view.nodes().find(n => n.tag === 'select').selectedIndex, 2)
    assert.match(view.text(), /0 \/ 50/)
    view.props.instrument = 'H30269'; await nextTick(); assert.ok(!view.text().includes('非 ETF 实际持仓'))
  } finally { view.unmount() }
})

test('同源日期修订的变更前后入口按观察时间定位，不混用同日名单', async () => {
  const data = inputs(2)
  data.history.snapshots[0].date = data.history.snapshots[1].date
  data.history.snapshots[0].observedAt = '2026-09-28T09:00:00Z'
  const view = await mount('ConstituentStructure', { instrument: 'H30269' }, createDashboardData({ constituents: () => data.current, constituentHistory: () => data.history }))
  try {
    await flush(); assert.match(view.text(), /同源日期修订/)
    view.button('查看变更前名单').props.onClick(); await nextTick()
    assert.match(view.text(), /0 \/ 50/)
    view.button('查看变更后名单').props.onClick(); await nextTick()
    assert.match(view.text(), /45 \/ 50/)
    assert.equal(view.nodes().find(n => n.tag === 'select').selectedIndex, 1)
  } finally { view.unmount() }
})

test('一侧失败保留整组上次分析；迟到的历史成功后整体替换，日期内容不匹配时行业留空', async () => {
  let version = 1, fail = false, release
  const dashboard = createDashboardData({ constituents: () => inputs(version).current, constituentHistory: () => {
    if (fail) throw new Error('offline')
    if (version === 2) return new Promise(done => { release = () => done(inputs(2).history) })
    return inputs().history
  } })
  const view = await mount('ConstituentStructure', { instrument: 'H30269' }, dashboard)
  try {
    await flush(); assert.match(view.text(), /尚未发现调入调出/)
    fail = true; version = 2
    await dashboard.refresh(['constituents']); await flush()
    assert.match(view.text(), /保留上次分析及原日期/); assert.match(view.text(), /offline/)
    assert.ok(!view.text().includes('新加入'))
    fail = false
    const refresh = dashboard.refresh(['constituentHistory']); await flush()
    assert.ok(!view.text().includes('新加入'))
    release(); await refresh; await flush(); assert.match(view.text(), /新加入/)
    dashboard.states.constituents.data = { ...inputs(2).current, date: '2026-09-29' }; await flush()
    assert.match(view.text(), /当前行业分布待同步/); assert.match(view.text(), /0 \/ 50/)
  } finally { view.unmount() }
})

test('结构模块与原成分股名单共用并发读取；首次失败显示空状态，不伪造历史', async () => {
  const calls = []
  const dashboard = createDashboardData({ constituents: () => { calls.push('members'); return inputs().current }, constituentHistory: () => { calls.push('history'); return inputs().history } })
  const structure = await mount('ConstituentStructure', { instrument: 'H30269' }, dashboard)
  const list = await mount('IndexConstituents', { instrument: 'H30269' }, dashboard)
  try { await flush(); assert.deepEqual(calls.sort(), ['history', 'members']); assert.match(list.text(), /金融/); assert.match(list.text(), /行业/) }
  finally { list.unmount(); structure.unmount() }
  const empty = await mount('ConstituentStructure', { instrument: 'H30269' }, createDashboardData({ constituents: () => { throw new Error('missing') }, constituentHistory: () => { throw new Error('missing') } }))
  try { await flush(); assert.match(empty.text(), /暂无可用名单/); assert.match(empty.text(), /历史尚未积累/); assert.ok(!empty.text().includes('调入 50')) }
  finally { empty.unmount() }
})
