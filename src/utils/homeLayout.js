export const HOME_LAYOUT_KEY = 'stock:home-layouts:v1'
export const MAX_HOME_LAYOUTS = 20
export const HOME_INSTRUMENTS = ['512890', 'H30269']
export const HOME_MODULES = [
  { id: 'today-overview', label: '今日与我有关', icon: 'bell' },
  { id: 'data-source-status', label: '后台采集状态', icon: 'database' },
  { id: 'key-metrics', label: '关键指标', icon: 'grid' },
  { id: 'market-chart', label: '行情走势', icon: 'chart' },
  { id: 'drawdown-analysis', label: '回撤曲线', icon: 'chart' },
  { id: 'observation-alerts', label: '观察提醒', icon: 'bell' },
  { id: 'performance-metrics', label: '收益与风险', icon: 'chart' },
  { id: 'index-comparison', label: '收益风险对比', icon: 'chart' },
  { id: 'low-volatility', label: '低波特征分析', icon: 'chart' },
  { id: 'etf-income', label: 'ETF 分红与收益', icon: 'chart', etf: true },
  { id: 'etf-nav-analysis', label: 'ETF 净值与跟踪', icon: 'chart', etf: true },
  { id: 'etf-liquidity', label: 'ETF 规模与交易成本', icon: 'chart', etf: true },
  { id: 'portfolio-ledger', label: '个人持仓与交易账本', icon: 'wallet', etf: true },
  { id: 'investment-simulator', label: '定投模拟器', icon: 'wallet' },
  { id: 'holding-periods', label: '滚动持有期', icon: 'chart' },
  { id: 'valuation-analysis', label: '估值分析', icon: 'chart' },
  { id: 'yield-spread', label: '股息与国债差值', icon: 'chart' },
  { id: 'constituent-structure', label: '成分与行业结构', icon: 'grid' },
  { id: 'dividend-quality', label: '分红质量与基本面', icon: 'chart' },
  { id: 'review-summary', label: '每周／每月复盘', icon: 'wallet' },
  { id: 'data-notes', label: '数据说明', icon: 'database' },
]
export const HOME_PRESETS = [
  { id: 'all', name: '默认全览', primary: HOME_MODULES.map(module => module.id) },
  { id: 'market', name: '看行情', primary: ['today-overview', 'key-metrics', 'market-chart', 'etf-liquidity', 'drawdown-analysis', 'observation-alerts', 'performance-metrics', 'index-comparison'] },
  { id: 'portfolio', name: '看持仓', primary: ['today-overview', 'portfolio-ledger', 'observation-alerts', 'market-chart', 'etf-income', 'etf-nav-analysis', 'etf-liquidity', 'review-summary'] },
  { id: 'research', name: '做研究', primary: ['key-metrics', 'valuation-analysis', 'etf-liquidity', 'yield-spread', 'constituent-structure', 'dividend-quality', 'index-comparison', 'low-volatility', 'holding-periods', 'investment-simulator', 'review-summary', 'data-notes'] },
]
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const known = new Set(HOME_MODULES.map(module => module.id))
const requireValue = (value, message) => { if (!value) throw new Error(message) }

// Preserve supported choices and append new modules as visible defaults. Never
// allow a stored duplicate or unknown module to remove an existing section.
export function normalizeHomeModules(input) {
  const seen = new Set(), output = []
  for (const item of Array.isArray(input) ? input : []) {
    if (!object(item) || !known.has(item.id) || seen.has(item.id)) continue
    seen.add(item.id)
    output.push({ id: item.id, hidden: item.hidden === true, collapsed: item.collapsed === true })
  }
  for (const module of HOME_MODULES) if (!seen.has(module.id)) output.push({ id: module.id, hidden: false, collapsed: false })
  return output
}
export function presetHomeModules(id) {
  const preset = HOME_PRESETS.find(item => item.id === id)
  requireValue(preset, '首页预设不存在')
  const order = [...preset.primary, ...HOME_MODULES.map(module => module.id).filter(key => !preset.primary.includes(key))]
  return order.map(key => ({ id: key, hidden: !preset.primary.includes(key), collapsed: false }))
}
export function defaultHomeLayouts() {
  return { schemaVersion: 1, current: Object.fromEntries(HOME_INSTRUMENTS.map(instrument => [instrument, { source: 'all', modules: presetHomeModules('all') }])), saved: [] }
}
export function homeLayoutName(value) {
  requireValue(typeof value === 'string', '请填写布局名称')
  const name = value.trim()
  requireValue(name.length > 0 && name.length <= 24 && !/[\u0000-\u001f\u007f]/.test(name), '布局名称须为 1–24 个字符，不能包含控制字符')
  return name
}
export function normalizeHomeLayouts(input) {
  requireValue(object(input) && input.schemaVersion === 1 && object(input.current) && Array.isArray(input.saved), '本机首页布局格式或版本不受支持')
  const output = defaultHomeLayouts(), ids = new Set()
  for (const item of input.saved) {
    if (output.saved.length >= MAX_HOME_LAYOUTS) break
    try {
      requireValue(object(item) && typeof item.id === 'string' && /^[\w-]{1,80}$/.test(item.id) && !HOME_PRESETS.some(preset => preset.id === item.id) && !ids.has(item.id) && HOME_INSTRUMENTS.includes(item.instrument) && Array.isArray(item.modules), '已保存布局无效')
      const name = homeLayoutName(item.name)
      requireValue(!output.saved.some(saved => saved.instrument === item.instrument && saved.name === name), '布局名称重复')
      output.saved.push({ id: item.id, instrument: item.instrument, name, modules: normalizeHomeModules(item.modules) }); ids.add(item.id)
    } catch { /* Keep valid independent layouts; discard malformed records. */ }
  }
  for (const instrument of HOME_INSTRUMENTS) {
    const current = input.current[instrument]
    if (!object(current)) continue
    const source = HOME_PRESETS.some(item => item.id === current.source) || output.saved.some(item => item.id === current.source && item.instrument === instrument) ? current.source : 'custom'
    output.current[instrument] = { source, modules: normalizeHomeModules(current.modules) }
  }
  return output
}
export function availableHomeModules(modules, instrument) {
  const definitions = new Map(HOME_MODULES.map(module => [module.id, module]))
  return modules.map(item => ({ ...definitions.get(item.id), ...item })).filter(module => !module.etf || instrument === '512890')
}
export function homeModuleForAnchor(anchor) {
  const id = anchor.replace(/^#/, '')
  if (known.has(id)) return id
  return { 'constituent-comparison': 'constituent-structure', 'constituent-weights': 'constituent-structure', 'holdings-comparison': 'constituent-structure', 'today-data-issues': 'today-overview' }[id] ?? null
}
