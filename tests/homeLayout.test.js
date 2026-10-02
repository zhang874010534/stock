import test from 'node:test'
import assert from 'node:assert/strict'
import { HOME_LAYOUT_KEY, HOME_MODULES, HOME_PRESETS, MAX_HOME_LAYOUTS, availableHomeModules, defaultHomeLayouts, homeModuleForAnchor, normalizeHomeLayouts, normalizeHomeModules, presetHomeModules } from '../src/utils/homeLayout.js'
import { createHomeLayout } from '../src/composables/useHomeLayout.js'

const memoryStorage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } }
const moduleOf = (store, id, instrument = '512890') => store.current(instrument).modules.find(module => module.id === id)

test('预设包含完整唯一模块集合，默认全览兼容原首页，持仓和研究有明确优先级', () => {
  const allIds = HOME_MODULES.map(module => module.id)
  for (const preset of HOME_PRESETS) {
    const modules = presetHomeModules(preset.id)
    assert.equal(new Set(modules.map(module => module.id)).size, allIds.length)
    assert.deepEqual([...modules.map(module => module.id)].sort(), [...allIds].sort())
    assert.deepEqual(modules.filter(module => !module.hidden).map(module => module.id), preset.primary)
  }
  assert.equal(presetHomeModules('all').filter(module => module.hidden).length, 0)
  assert.equal(presetHomeModules('portfolio')[1].id, 'portfolio-ledger')
  assert.ok(presetHomeModules('research').findIndex(module => module.id === 'valuation-analysis') < presetHomeModules('research').findIndex(module => module.id === 'market-chart'))
  assert.equal(availableHomeModules(presetHomeModules('all'), 'H30269').length, HOME_MODULES.length - 3)
  assert.equal(homeModuleForAnchor('#constituent-comparison'), 'constituent-structure')
  assert.equal(homeModuleForAnchor('#today-data-issues'), 'today-overview')
  assert.equal(homeModuleForAnchor('#not-a-module'), null)
})

test('存储归一化去除未知和重复项，保留有效设置并补入新模块', () => {
  const modules = normalizeHomeModules([{ id: 'portfolio-ledger', hidden: true, collapsed: true, unsafe: 1 },
    { id: 'portfolio-ledger', hidden: false }, { id: 'unknown', hidden: true }, { id: 'key-metrics', hidden: 'true', collapsed: 1 }])
  assert.deepEqual(modules[0], { id: 'portfolio-ledger', hidden: true, collapsed: true })
  assert.deepEqual(modules[1], { id: 'key-metrics', hidden: false, collapsed: false })
  assert.equal(modules.length, HOME_MODULES.length)
  const document = defaultHomeLayouts()
  document.saved = [{ id: 'one', instrument: '512890', name: '有效布局', modules: modules.slice(0, 1) },
    { id: 'one', instrument: 'H30269', name: '重复编号', modules }, { id: 'bad', instrument: 'wrong', name: '错误证券', modules }]
  document.current['512890'] = { source: 'one', modules }
  const valid = normalizeHomeLayouts(document)
  assert.equal(valid.saved.length, 1); assert.equal(valid.saved[0].modules.length, HOME_MODULES.length)
  assert.equal(valid.current['512890'].source, 'one')
  document.current.H30269.source = 'one'
  assert.equal(normalizeHomeLayouts(document).current.H30269.source, 'custom')
  assert.throws(() => normalizeHomeLayouts({ schemaVersion: 2 }), /版本/)
})

test('每只证券独立保存折叠、隐藏和排序，重新打开恢复，不写入其他本机数据', () => {
  const storage = memoryStorage(); storage.setItem('stock:portfolio-ledger:v1', 'ledger-original')
  let store = createHomeLayout({ storage })
  store.configure('512890', 'market-chart', 'hidden', true)
  store.configure('512890', 'market-chart', 'collapsed', true)
  store.move('512890', 'portfolio-ledger', -1)
  const order = store.current('512890').modules.map(module => module.id)
  assert.ok(store.dirty('512890')); assert.equal(moduleOf(store, 'market-chart', 'H30269').hidden, false)
  store = createHomeLayout({ storage })
  assert.equal(moduleOf(store, 'market-chart').hidden, true); assert.equal(moduleOf(store, 'market-chart').collapsed, true)
  assert.deepEqual(store.current('512890').modules.map(module => module.id), order)
  assert.equal(storage.getItem('stock:portfolio-ledger:v1'), 'ledger-original')
  store.apply('512890', 'all'); assert.equal(moduleOf(store, 'market-chart').hidden, false)
  store.undoApply('512890'); assert.equal(moduleOf(store, 'market-chart').hidden, true)
})

test('保存命名布局为独立快照，编辑不会改原快照，更新、删除撤销及切换撤销可恢复', () => {
  const storage = memoryStorage(); let counter = 0
  const store = createHomeLayout({ storage, id: () => `layout-${++counter}` })
  store.apply('512890', 'portfolio')
  const first = store.saveAs('512890', ' 我的持仓 ')
  assert.equal(first.name, '我的持仓'); assert.equal(store.dirty('512890'), false)
  store.configure('512890', 'portfolio-ledger', 'collapsed', true)
  assert.equal(first.modules.find(module => module.id === 'portfolio-ledger').collapsed, false)
  assert.equal(store.dirty('512890'), true)
  store.updateSaved('512890', '持仓简版'); assert.equal(store.dirty('512890'), false)
  store.saveAs('H30269', '指数研究')
  store.removeSaved('512890'); assert.equal(store.current('512890').source, 'custom')
  assert.equal(moduleOf(store, 'portfolio-ledger').collapsed, true)
  store.undoRemove(); store.apply('512890', first.id)
  assert.equal(store.sourceName('512890'), '持仓简版')
  store.apply('512890', 'market'); store.undoApply('512890')
  assert.equal(store.current('512890').source, first.id)
  const reopened = createHomeLayout({ storage })
  assert.equal(reopened.sourceName('512890'), '持仓简版'); assert.equal(reopened.state.saved.length, 2)
  assert.throws(() => reopened.apply('H30269', first.id), /预设不存在/)
  reopened.apply('512890', first.id)
  reopened.removeSaved('512890')
  reopened.undoApply('512890')
  assert.equal(reopened.current('512890').source, 'custom')
  assert.equal(reopened.sourceLayout('512890'), undefined)
  assert.equal(moduleOf(reopened, 'portfolio-ledger').collapsed, true)
})

test('排序跳过指数页面不适用的 ETF 项，边界无变动；直接定位恢复显示和展开', () => {
  const store = createHomeLayout({ storage: memoryStorage() })
  const indexIds = () => availableHomeModules(store.current('H30269').modules, 'H30269').map(module => module.id)
  const before = indexIds(), from = before.indexOf('investment-simulator')
  store.move('H30269', 'investment-simulator', -1)
  assert.equal(indexIds()[from - 1], 'investment-simulator'); assert.equal(indexIds()[from], 'low-volatility')
  store.move('H30269', indexIds()[0], -1); assert.equal(indexIds()[0], before[0])
  store.apply('512890', 'market')
  store.configure('512890', 'portfolio-ledger', 'collapsed', true)
  assert.equal(store.reveal('512890', 'portfolio-ledger'), true)
  assert.deepEqual(moduleOf(store, 'portfolio-ledger'), { id: 'portfolio-ledger', hidden: false, collapsed: false })
  assert.equal(store.reveal('512890', 'portfolio-ledger'), false)
  assert.throws(() => store.configure('512890', 'unknown', 'hidden', true), /不存在/)
})

test('同名、无效名称、重复编号、保存上限和撤销冲突不会破坏已有布局', () => {
  let counter = 0
  const store = createHomeLayout({ storage: memoryStorage(), id: () => `layout-${++counter}` })
  store.saveAs('512890', '研究')
  assert.throws(() => store.saveAs('512890', '研究'), /同名/)
  assert.throws(() => store.saveAs('512890', ' '.repeat(5)), /字符/)
  assert.throws(() => store.saveAs('512890', 'x'.repeat(25)), /字符/)
  store.removeSaved('512890'); store.saveAs('512890', '研究')
  assert.throws(() => store.undoRemove(), /同名/)
  for (let i = 1; i < MAX_HOME_LAYOUTS; i++) store.saveAs('512890', `布局${i}`)
  assert.throws(() => store.saveAs('512890', '额外布局'), /最多保存/)
  const repeated = createHomeLayout({ storage: memoryStorage(), id: () => 'same' })
  repeated.saveAs('512890', '第一份')
  assert.throws(() => repeated.saveAs('H30269', '第二份'), /编号/)
  assert.equal(repeated.state.saved.length, 1)
})

test('损坏或不支持的首页存储保持原文，禁止存储仍允许本页调整', () => {
  const storage = memoryStorage(); storage.setItem(HOME_LAYOUT_KEY, '{invalid')
  const store = createHomeLayout({ storage })
  store.apply('512890', 'market'); store.saveAs('512890', '临时布局')
  assert.equal(storage.getItem(HOME_LAYOUT_KEY), '{invalid'); assert.equal(store.hasWarning.value, true)
  assert.match(store.message.value, /原存储已保留/)
  const denied = createHomeLayout({ storage: { getItem: () => null, setItem: () => { throw new Error('denied') } } })
  denied.configure('512890', 'market-chart', 'collapsed', true)
  assert.equal(moduleOf(denied, 'market-chart').collapsed, true); assert.match(denied.message.value, /保存失败/)
})
