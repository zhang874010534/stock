import { computed, inject, provide, reactive, ref } from 'vue'
import { HOME_INSTRUMENTS, HOME_LAYOUT_KEY, HOME_PRESETS, MAX_HOME_LAYOUTS, defaultHomeLayouts, homeLayoutName, normalizeHomeLayouts, presetHomeModules } from '../utils/homeLayout.js'

const homeLayoutKey = Symbol('home-layouts')
const copyModules = modules => modules.map(module => ({ ...module }))
export function createHomeLayout({ storage, id = () => crypto.randomUUID() } = {}) {
  const error = ref(''), notice = ref(''), removed = ref(null), previous = ref(null)
  const getStorage = () => storage ?? globalThis.localStorage
  let initial = defaultHomeLayouts(), readable = true
  try {
    const raw = getStorage()?.getItem(HOME_LAYOUT_KEY)
    if (raw != null) initial = normalizeHomeLayouts(JSON.parse(raw))
  } catch { readable = false; error.value = '本机首页布局无法读取，原存储已保留。当前调整仅在本页生效。' }
  const state = reactive(initial)
  const current = instrument => {
    if (!HOME_INSTRUMENTS.includes(instrument)) throw new Error('证券不受支持')
    return state.current[instrument]
  }
  function persist(message = '') {
    notice.value = message
    if (!readable) return
    try {
      const target = getStorage()
      if (!target) throw new Error('Storage unavailable')
      target.setItem(HOME_LAYOUT_KEY, JSON.stringify(normalizeHomeLayouts(state))); error.value = ''
    } catch { error.value = '首页布局保存失败，当前调整仍可使用，重新打开后可能无法保留。' }
  }
  function configure(instrument, moduleId, field, value) {
    if (!['hidden', 'collapsed'].includes(field) || typeof value !== 'boolean') throw new Error('模块设置无效')
    const module = current(instrument).modules.find(item => item.id === moduleId)
    if (!module) throw new Error('首页模块不存在')
    module[field] = value; persist()
  }
  function move(instrument, moduleId, direction) {
    if (![1, -1].includes(direction)) throw new Error('排序方向无效')
    const modules = current(instrument).modules, index = modules.findIndex(item => item.id === moduleId)
    if (index < 0) throw new Error('首页模块不存在')
    // Skip ETF-only rows when ordering the index page.
    const etfOnly = new Set(['etf-income', 'etf-nav-analysis', 'portfolio-ledger'])
    let target = index + direction
    while (instrument !== '512890' && target >= 0 && target < modules.length && etfOnly.has(modules[target].id)) target += direction
    if (target < 0 || target >= modules.length) return
    const [item] = modules.splice(index, 1); modules.splice(target, 0, item); persist()
  }
  function apply(instrument, source) {
    const saved = state.saved.find(item => item.instrument === instrument && item.id === source)
    const modules = saved ? copyModules(saved.modules) : presetHomeModules(source)
    previous.value = { instrument, ...current(instrument), modules: copyModules(current(instrument).modules) }
    state.current[instrument] = { source, modules }; persist('已切换首页布局，可撤销本次切换。')
  }
  function undoApply(instrument) {
    if (previous.value?.instrument !== instrument) return
    const { source, modules } = previous.value
    const exists = HOME_PRESETS.some(item => item.id === source) || state.saved.some(item => item.instrument === instrument && item.id === source)
    state.current[instrument] = { source: exists ? source : 'custom', modules: copyModules(modules) }; previous.value = null; persist('已恢复切换前的首页布局。')
  }
  function saveAs(instrument, value) {
    const name = homeLayoutName(value)
    if (state.saved.length >= MAX_HOME_LAYOUTS) throw new Error(`最多保存 ${MAX_HOME_LAYOUTS} 个命名布局`)
    if (state.saved.some(item => item.instrument === instrument && item.name === name)) throw new Error('当前证券已有同名布局，请改名或更新已有布局')
    const saved = { id: id(), name, instrument, modules: copyModules(current(instrument).modules) }
    if (state.saved.some(item => item.id === saved.id)) throw new Error('布局编号无效或重复')
    const candidate = normalizeHomeLayouts({ ...state, saved: [...state.saved, saved] })
    if (!candidate.saved.some(item => item.id === saved.id)) throw new Error('布局编号无效或重复')
    state.saved.push(saved); current(instrument).source = saved.id; persist(`布局“${name}”已保存。`)
    return saved
  }
  function updateSaved(instrument, value) {
    const layout = current(instrument), saved = state.saved.find(item => item.instrument === instrument && item.id === layout.source)
    if (!saved) throw new Error('请先选择一个已保存布局')
    const name = homeLayoutName(value)
    if (state.saved.some(item => item.id !== saved.id && item.instrument === instrument && item.name === name)) throw new Error('当前证券已有同名布局')
    saved.name = name; saved.modules = copyModules(layout.modules); persist(`布局“${name}”已更新。`)
  }
  function removeSaved(instrument) {
    const source = current(instrument).source, saved = state.saved.find(item => item.instrument === instrument && item.id === source)
    if (!saved) return
    removed.value = { ...saved, modules: copyModules(saved.modules) }
    state.saved = state.saved.filter(item => item.id !== source); current(instrument).source = 'custom'; persist('命名布局已删除，当前页面排列保留，可撤销删除。')
  }
  function undoRemove() {
    const saved = removed.value
    if (!saved) return
    if (state.saved.length >= MAX_HOME_LAYOUTS || state.saved.some(item => item.id === saved.id || item.instrument === saved.instrument && item.name === saved.name)) throw new Error('已有同名布局或保存数量已满，无法恢复')
    state.saved.push({ ...saved, modules: copyModules(saved.modules) }); removed.value = null; persist('命名布局已恢复，可从布局列表重新选择。')
  }
  function reveal(instrument, moduleId) {
    const module = current(instrument).modules.find(item => item.id === moduleId)
    if (!module || (!module.hidden && !module.collapsed)) return false
    module.hidden = false; module.collapsed = false; persist('已显示并展开目标模块。')
    return true
  }
  const sourceLayout = instrument => state.saved.find(item => item.instrument === instrument && item.id === current(instrument).source)
  const sourceName = instrument => sourceLayout(instrument)?.name ?? HOME_PRESETS.find(item => item.id === current(instrument).source)?.name ?? '自定义排列'
  const dirty = instrument => {
    const layout = current(instrument), saved = sourceLayout(instrument)
    const source = saved?.modules ?? (HOME_PRESETS.some(item => item.id === layout.source) ? presetHomeModules(layout.source) : null)
    return source ? JSON.stringify(layout.modules) !== JSON.stringify(source) : false
  }
  return { state, current, sourceLayout, sourceName, dirty, removed, previous, message: computed(() => error.value || notice.value), hasWarning: computed(() => Boolean(error.value)),
    configure, move, apply, undoApply, saveAs, updateSaved, removeSaved, undoRemove, reveal }
}
export function provideHomeLayout(layout = createHomeLayout()) { provide(homeLayoutKey, layout); return layout }
export function useHomeLayout() { return inject(homeLayoutKey, null) ?? createHomeLayout() }
