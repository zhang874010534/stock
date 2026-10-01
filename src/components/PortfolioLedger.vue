<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { usePortfolioLedger } from '../composables/usePortfolioLedger.js'
import { LEDGER_TYPES, MAX_LEDGER_BACKUP_BYTES, localDate, portfolioSummary } from '../utils/portfolioLedger.js'
import { downloadBlob } from '../utils/chartExport.js'

const props = defineProps({ market: Object, loading: Boolean, error: String, sourceNotice: String })
const ledger = usePortfolioLedger()
const clock = ref(new Date())
const today = computed(() => localDate(clock.value))
let clockTimer
onMounted(() => { clockTimer = setInterval(() => { clock.value = new Date() }, 60000) })
onBeforeUnmount(() => clearInterval(clockTimer))
const formOpen = ref(false), formError = ref(''), actionError = ref(''), dateInput = ref(null)
const draft = reactive({ id: null, type: 'buy', date: '', sequence: 1, quantity: '', price: '', fee: '0', amount: '', ratio: '', note: '' })
const isTrade = computed(() => ['buy', 'sell'].includes(draft.type))
const isCash = computed(() => ['dividend', 'fee'].includes(draft.type))
const summary = computed(() => portfolioSummary(ledger.entries.value, props.market?.latest, { now: clock.value }))
const money = value => value == null ? '—' : new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
const quantity = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value)
const percent = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`
const rows = computed(() => [...summary.value.rows].reverse())
const nextSequence = date => Math.max(0, ...ledger.entries.value.filter(entry => entry.date === date).map(entry => entry.sequence)) + 1
const cards = computed(() => [
  { label: '持有份额', value: `${quantity(summary.value.shares)} 份` },
  { label: '持仓成本（含买入费）', value: `${money(summary.value.cost)} 元` },
  { label: '每份平均成本', value: summary.value.averageCost === null ? '—' : `${summary.value.averageCost.toFixed(4)} 元` },
  { label: '持仓市值', value: money(summary.value.marketValue), currency: true },
  { label: '浮动盈亏', value: money(summary.value.unrealized), currency: true },
  { label: '已实现交易盈亏', value: `${money(summary.value.realized)} 元` },
  { label: '现金分红（扣费后）', value: `${money(summary.value.dividends)} 元` },
  { label: '累计盈亏', value: money(summary.value.totalProfit), currency: true },
  { label: '累计盈亏 / 累计买入支出', value: percent(summary.value.totalReturn) },
  { label: 'XIRR（年化）', value: percent(summary.value.xirr.value) },
])
async function newEntry(type = 'buy') {
  clock.value = new Date()
  const date = props.market?.latest?.date ?? today.value
  Object.assign(draft, { id: null, type, date, sequence: nextSequence(date), quantity: '', price: '', fee: '0', amount: '', ratio: '', note: '' })
  formError.value = ''; formOpen.value = true; ledger.select(null)
  await nextTick(); dateInput.value?.focus()
}
async function editEntry(id) {
  const entry = ledger.entries.value.find(item => item.id === id)
  if (!entry) return
  Object.assign(draft, entry, { quantity: entry.quantity ?? '', price: entry.price ?? '', amount: entry.amount ?? '', ratio: entry.ratio ?? '' })
  formError.value = ''; formOpen.value = true
  await nextTick(); dateInput.value?.focus({ preventScroll: true })
}
function save() {
  try {
    ledger.upsert({ id: draft.id, type: draft.type, date: draft.date, sequence: Number(draft.sequence),
      quantity: isTrade.value ? Number(draft.quantity) : null, price: isTrade.value ? Number(draft.price) : null,
      amount: isCash.value ? Number(draft.amount) : null, fee: ['fee', 'split'].includes(draft.type) ? 0 : Number(draft.fee),
      ratio: draft.type === 'split' ? Number(draft.ratio) : null, note: draft.note })
    formOpen.value = false; formError.value = ''; actionError.value = ''; ledger.select(null)
  } catch (error) { formError.value = error.message }
}
function remove(id) {
  try {
    ledger.remove(id); actionError.value = ''
    if (draft.id === id) formOpen.value = false
  } catch (error) { actionError.value = `删除未执行：${error.message}。请先处理依赖此记录的后续交易。` }
}
function undo() {
  try { ledger.undoRemove(); actionError.value = '' } catch (error) { actionError.value = `撤销未执行：${error.message}` }
}
function exportBackup() {
  try {
    downloadBlob(new Blob([ledger.exportBackup()], { type: 'application/json' }), `512890_交易账本_${today.value}.json`)
    actionError.value = ''
  } catch (error) { actionError.value = `导出失败：${error.message}` }
}
async function importBackup(event) {
  const input = event.target, file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > MAX_LEDGER_BACKUP_BYTES) throw new Error('账本备份不能超过 4 MB')
    ledger.importBackup(await file.text()); actionError.value = ''; formOpen.value = false; ledger.select(null)
  } catch (error) { actionError.value = `导入未执行：${error.message}。原账本已保留。` }
  finally { input.value = '' }
}
watch(() => draft.date, date => { if (!draft.id) draft.sequence = nextSequence(date) })
watch(ledger.selectedId, id => { if (id) editEntry(id) })
defineExpose({ newEntry, editEntry })
</script>

<template>
  <section class="portfolio-ledger panel" aria-label="个人持仓与交易账本">
    <header class="ledger-heading"><div><h2>个人持仓与交易账本</h2><p>512890 · 实际成交手动记账 · 当前浏览器保存</p></div><div class="ledger-actions"><button type="button" @click="exportBackup">导出账本 JSON</button><label class="import-button">导入备份<input type="file" accept=".json,application/json" aria-label="选择账本备份文件" @change="importBackup" /></label></div></header>
    <p class="ledger-note">请输入自己的实际成交价和费用。买卖记录会显示在 K 线上；交易日期没有已同步行情时保留账本，暂不显示标记。分红按实际到账金额录入，不自动计入公开分红记录。</p>
    <p v-if="ledger.message.value" class="ledger-warning" role="status">{{ ledger.message.value }}</p>
    <p v-if="actionError" class="ledger-warning" role="alert">{{ actionError }}</p>
    <p v-if="error" class="ledger-warning" role="status">行情读取失败{{ market ? '，暂按原行情估值' : '，当前没有行情估值' }}：{{ error }}</p>
    <p v-if="loading" class="ledger-note" role="status">正在读取行情，账本记录可以继续编辑。</p>
    <p v-if="sourceNotice" class="ledger-warning" role="status">行情状态：{{ sourceNotice }}</p>
    <div class="ledger-cards"><div v-for="card in cards" :key="card.label" class="ledger-card"><span>{{ card.label }}</span><strong>{{ card.value }}{{ card.currency && card.value !== '—' ? ' 元' : '' }}</strong></div></div>
    <p v-if="summary.valuationReason" class="ledger-warning" role="status">{{ summary.valuationReason }}</p>
    <p v-else class="ledger-note">{{ summary.shares > 0 ? `按 ${summary.asOf} 已同步收盘价 ${market.latest.close} 元估值，非实时持仓市值。` : `已清仓，收益截至最后一笔记录 ${summary.asOf}。` }} 累计买入支出 {{ money(summary.invested) }} 元 · 全部已录入费用 {{ money(summary.fees) }} 元 · 其他费用 {{ money(summary.otherFees) }} 元。</p>
    <p v-if="summary.xirr.reason && ledger.entries.value.length" class="ledger-note">XIRR 暂不展示：{{ summary.xirr.reason }}。</p>
    <div class="ledger-actions add-actions"><button v-for="(label, type) in LEDGER_TYPES" :key="type" type="button" @click="newEntry(type)">记录{{ label }}</button><button v-if="ledger.removed.value" type="button" @click="undo">撤销最近一次删除</button></div>
    <form v-if="formOpen" class="ledger-form" aria-label="交易账本录入" @submit.prevent="save">
      <p class="form-title">{{ draft.id ? '编辑记录' : '新增记录' }}</p>
      <label>记录类型<select v-model="draft.type" aria-label="账本记录类型"><option v-for="(label, type) in LEDGER_TYPES" :key="type" :value="type">{{ label }}</option></select></label>
      <label>日期<input ref="dateInput" v-model="draft.date" type="date" :max="today" required aria-label="账本日期" /></label>
      <label>同日顺序<input v-model="draft.sequence" type="number" min="1" max="1000000" step="1" required aria-label="账本同日顺序" /></label>
      <template v-if="isTrade"><label>成交份额<input v-model="draft.quantity" type="number" min="1" max="1000000000" step="1" required aria-label="账本成交份额" /></label><label>成交价（元／份）<input v-model="draft.price" type="number" min="0.000001" max="1000000" step="any" required aria-label="账本成交价" /></label></template>
      <label v-if="isCash">{{ draft.type === 'fee' ? '实际费用金额（元）' : '分红总额（扣费前，元）' }}<input v-model="draft.amount" type="number" min="0.01" max="1000000000000" step="0.01" required aria-label="账本现金金额" /></label>
      <label v-if="!['fee', 'split'].includes(draft.type)">{{ draft.type === 'dividend' ? '分红扣费（元）' : '成交费用（元）' }}<input v-model="draft.fee" type="number" min="0" max="1000000000" step="0.01" required aria-label="账本费用" /></label>
      <label v-if="draft.type === 'split'">份额倍率（新份额／原份额）<input v-model="draft.ratio" type="number" min="0.000001" max="10000" step="any" required aria-label="账本份额倍率" /></label>
      <label class="note-field">备注<textarea v-model="draft.note" rows="2" maxlength="500" aria-label="账本备注" placeholder="可记录成交原因、分红核对情况等" /></label>
      <p class="ledger-note form-caption">同一天按顺序计算，卖出不能超过当时持仓。成交份额不强制整手；份额调整仅改变份额和每份成本，总成本不变。修改早期记录会重新核算后续记录。</p>
      <p v-if="formError" class="ledger-warning form-caption" role="alert">{{ formError }}</p>
      <div class="ledger-actions form-caption"><button type="submit">保存记录</button><button type="button" @click="formOpen = false; ledger.select(null)">取消</button></div>
    </form>
    <p v-if="!rows.length" class="empty-ledger">还没有交易记录。点击“记录买入”，从第一笔实际成交开始。</p>
    <div v-else class="ledger-table-wrap"><table><caption>实际记录 · 最近日期在前，同日按顺序倒序显示</caption><thead><tr><th>日期／顺序</th><th>类型</th><th>份额</th><th>成交价</th><th>成交／现金金额</th><th>附加费用</th><th>本笔现金流</th><th>本笔交易盈亏</th><th>交易后份额</th><th>备注</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.date }} / {{ row.sequence }}</td><td>{{ LEDGER_TYPES[row.type] }}{{ row.type === 'split' ? ` ×${row.ratio}` : '' }}</td><td>{{ row.quantity === null ? '—' : quantity(row.quantity) }}</td><td>{{ row.price ?? '—' }}</td><td>{{ money(row.grossAmount) }}</td><td>{{ money(row.fee) }}</td><td>{{ money(row.cashFlow) }}</td><td>{{ money(row.profit) }}</td><td>{{ quantity(row.shares) }}</td><td class="row-note">{{ row.note || '—' }}</td><td><div class="ledger-actions"><button type="button" :aria-label="`编辑交易 ${row.id}`" @click="editEntry(row.id)">编辑</button><button type="button" :aria-label="`删除交易 ${row.id}`" @click="remove(row.id)">删除</button></div></td></tr></tbody></table></div>
    <details class="ledger-method"><summary>成本、盈亏和 XIRR 如何计算</summary><p>成本采用移动加权平均法。买入成本 = 成交金额 + 买入费用；卖出按成交前平均成本结转，已实现交易盈亏 = 卖出金额 − 卖出费用 − 结转成本。分红不降低持仓成本，其他费用单独扣除。成交金额按每笔四舍五入到分，部分卖出的成本按比例结转。</p><p>浮动盈亏 = 持仓市值 − 剩余持仓成本；累计盈亏 = 已实现交易盈亏 + 浮动盈亏 + 扣费后分红 − 其他费用。累计盈亏除以累计买入支出仅为账本比例，重复买卖会重复累计支出，不是时间加权收益。</p><p>XIRR 使用实际日期，按 ACT/365 年化：买入及费用为负现金流，卖出及到账分红为正现金流，剩余持仓按行情日期的收盘市值作为期末正现金流。同日现金流合并；没有正负现金流、没有跨日区间、存在多个解或无法求解时不展示单一数值。清仓后按实际现金流计算。极端年化结果可能无法求解；先收回再投入等多次变号的现金流最多计算 256 个有效日期。卖出和分红视为从该证券收回现金，未投资现金不计利息。</p><p>账本不自动导入基金分红或拆分，也不推算未记账税费。跨越份额拆分时，按自己的成交和份额变化补录“份额调整”；分红按实际到账日录入，可在分红金额中填净额并将扣费设为零。原有 K 线和公开分红收益分析仍使用各自数据口径。</p><p>记录仅保存在当前浏览器、当前站点，不跨设备同步。JSON 备份合并会检查编号、交易顺序和超卖；导入、修改或删除会导致无效持仓时拒绝操作并保留原账本。浏览器清理存储前请导出备份。</p></details>
  </section>
</template>

<style scoped>
.portfolio-ledger { padding: 18px 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }
.ledger-heading, .ledger-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }.ledger-heading { justify-content: space-between; gap: 12px; } h2 { font-size: 15px; }
.ledger-heading p, .ledger-note { color: #93a4bf; font-size: 11px; line-height: 1.8; margin-top: 8px; overflow-wrap: anywhere; }.ledger-warning { color: #d5b57f; font-size: 12px; line-height: 1.8; margin-top: 8px; overflow-wrap: anywhere; }
button, select, input, textarea, .import-button { padding: 7px 9px; border: 1px solid #33435b; border-radius: 5px; background: #111d30; color: #c7d8f2; font: inherit; font-size: 12px; }button, .import-button { cursor: pointer; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, .import-button:focus-within { outline: 2px solid #67d5df; outline-offset: 2px; }
.import-button { position: relative; overflow: hidden; }.import-button input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.ledger-cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }.ledger-card { min-width: 0; padding: 12px; border: 1px solid #223049; background: #0a1220; border-radius: 6px; }.ledger-card span { display: block; color: #93a4bf; font-size: 11px; line-height: 1.6; }.ledger-card strong { display: block; margin-top: 8px; color: #d8e6f5; font-size: 15px; font-family: var(--font-mono); overflow-wrap: anywhere; }
.add-actions { margin-top: 16px; }.ledger-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 14px; margin-top: 14px; border: 1px solid #33435b; border-radius: 8px; }.form-title, .note-field, .form-caption { grid-column: 1 / -1; }.form-title { color: #d8e6f5; font-size: 13px; }
.ledger-form label { font-size: 12px; color: #acbcd3; min-width: 0; }.ledger-form input, select, textarea { display: block; width: 100%; min-width: 0; box-sizing: border-box; margin-top: 6px; color-scheme: dark; }
.empty-ledger { padding: 24px 0; color: #93a4bf; font-size: 12px; }.ledger-table-wrap { overflow: auto; max-height: 480px; margin-top: 14px; }table { width: 100%; border-collapse: collapse; font-size: 11px; }caption { text-align: left; color: #b8ceec; padding-bottom: 8px; }th, td { padding: 9px 8px; border-bottom: 1px solid #223049; text-align: right; white-space: nowrap; }th { color: #93a4bf; font-weight: 500; }td { color: #d8e6f5; font-family: var(--font-mono); }th:first-child, td:first-child { text-align: left; }.row-note { min-width: 120px; max-width: 230px; white-space: normal; overflow-wrap: anywhere; text-align: left; }.ledger-table-wrap .ledger-actions { flex-wrap: nowrap; }
.ledger-method { margin-top: 14px; border-top: 1px solid #223049; padding-top: 12px; }.ledger-method summary { cursor: pointer; color: #b9c9df; font-size: 12px; }.ledger-method p { color: #93a4bf; font-size: 11px; line-height: 1.8; margin-top: 8px; }
@media (max-width: 1200px) { .ledger-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .portfolio-ledger { padding: 15px 12px; }.ledger-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }.ledger-card strong { font-size: 13px; }.ledger-form { grid-template-columns: minmax(0, 1fr); padding: 12px; } }
</style>
