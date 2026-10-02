import { computed, ref } from 'vue'
import { INVESTMENT_STRATEGIES, validateSimulatorConfig } from '../utils/investmentSimulator.js'

export const INVESTMENT_PLANS_KEY = 'stock:investment-plans:v1'
export const MAX_INVESTMENT_PLANS = 30
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export function validateInvestmentPlan(input) {
  requireValue(input && typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id), '方案编号异常')
  requireValue(typeof input.name === 'string' && input.name.trim() && input.name.length <= 60, '方案名称须为 1–60 字')
  requireValue(INVESTMENT_STRATEGIES.some(item => item.key === input.strategy), '方案策略无效')
  requireValue(typeof input.savedAt === 'string' && Number.isFinite(Date.parse(input.savedAt)) && new Date(input.savedAt).toISOString() === input.savedAt, '方案保存时间异常')
  return { id: input.id, name: input.name.trim(), instrument: input.instrument, strategy: input.strategy, savedAt: input.savedAt, config: validateSimulatorConfig(input.config, input.instrument) }
}
export function validateInvestmentPlans(document) {
  requireValue(document?.schemaVersion === 1 && Array.isArray(document.plans) && document.plans.length <= MAX_INVESTMENT_PLANS, '定投方案保存格式异常')
  const plans = document.plans.map(validateInvestmentPlan)
  requireValue(new Set(plans.map(plan => plan.id)).size === plans.length, '方案编号重复')
  return plans
}
export function createInvestmentPlans({ storage, now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
  const plans = ref([]), removed = ref(null), error = ref(''), notice = ref('')
  let readable = true
  const getStorage = () => storage ?? globalThis.localStorage
  try {
    const raw = getStorage()?.getItem(INVESTMENT_PLANS_KEY)
    if (raw != null) plans.value = validateInvestmentPlans(JSON.parse(raw))
  } catch { readable = false; error.value = '定投方案读取失败，为保留原记录，当前改动仅留在页面中。' }
  function persist(text) {
    notice.value = text
    if (!readable) return
    try {
      const target = getStorage()
      if (!target) throw new Error('Storage unavailable')
      target.setItem(INVESTMENT_PLANS_KEY, JSON.stringify({ schemaVersion: 1, plans: validateInvestmentPlans({ schemaVersion: 1, plans: plans.value }) }))
      error.value = ''
    } catch { error.value = '定投方案保存失败，当前改动仅留在页面中；请检查浏览器存储空间。' }
  }
  function save(input) {
    if (plans.value.length >= MAX_INVESTMENT_PLANS) throw new Error(`最多保存 ${MAX_INVESTMENT_PLANS} 套方案，请先删除不需要的方案（可撤销）`)
    const plan = validateInvestmentPlan({ ...input, id: id(), savedAt: now().toISOString() })
    requireValue(!plans.value.some(item => item.id === plan.id), '方案编号重复，请重试')
    plans.value = [plan, ...plans.value]; persist('已另存一套方案到当前浏览器。'); return plan
  }
  function remove(planId) {
    const plan = plans.value.find(item => item.id === planId)
    if (!plan) return
    removed.value = validateInvestmentPlan(plan); plans.value = plans.value.filter(item => item.id !== planId)
    persist('方案已删除，可撤销最近一次删除。')
  }
  function undoRemove() {
    if (!removed.value) return
    requireValue(plans.value.length < MAX_INVESTMENT_PLANS && !plans.value.some(item => item.id === removed.value.id), '达到保存上限或编号重复，暂不能恢复')
    plans.value = [removed.value, ...plans.value]; removed.value = null; persist('已恢复删除的方案。')
  }
  return { plans, removed, message: computed(() => error.value || notice.value), hasWarning: computed(() => Boolean(error.value)), save, remove, undoRemove }
}
