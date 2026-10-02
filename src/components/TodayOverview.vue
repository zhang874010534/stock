<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowUpRight, Bell, CalendarDays, ChartNoAxesCombined, CircleAlert, Layers, Wallet } from 'lucide-vue-next'
import { useDashboardData } from '../composables/useDashboardData.js'
import { usePortfolioLedger } from '../composables/usePortfolioLedger.js'
import { todayOverview } from '../utils/todayOverview.js'
import { signedValue } from '../utils/marketSummary.js'

const props = defineProps({ instrument: { type: String, default: '512890' },
  alerts: { type: Object, default: () => ({}) }, constituentInputs: Object, moduleWarnings: { type: Array, default: () => [] } })
const emit = defineEmits(['navigate'])
const dashboard = useDashboardData(), ledger = usePortfolioLedger(), clock = ref(new Date())
let timer
onMounted(() => { timer = setInterval(() => { clock.value = new Date() }, 60000) })
onUnmounted(() => clearInterval(timer))
const overview = computed(() => todayOverview({ instrument: props.instrument, states: dashboard.states,
  entries: ledger.entries.value, constituentInputs: props.constituentInputs, moduleWarnings: [...props.moduleWarnings,
    { active: props.instrument === '512890' && ledger.hasWarning.value, target: '#portfolio-ledger', label: '个人账本', message: ledger.message.value }], now: clock.value }))
const etf = computed(() => props.instrument === '512890')
const money = value => value == null ? '—' : `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`
const tone = value => value > 0 ? 'up' : value < 0 ? 'down' : ''
const issueDetails = ref(null)
function jump(target) { emit('navigate', target) }
</script>

<template>
  <section id="today-overview" class="today-overview panel" aria-labelledby="today-overview-title" :aria-busy="overview.loading">
    <header class="overview-heading"><div><p class="overview-eyebrow"><CalendarDays :size="14" />{{ overview.today }} · {{ instrument }}</p><h2 id="today-overview-title">今日与我有关</h2></div><span class="overview-status" role="status">{{ overview.loading ? '正在核对已保存数据…' : '概览随本页数据与账本更新' }}</span></header>
    <p class="overview-note">最新已收盘观察，各项保留实际日期。点击卡片查看详情。</p>
    <div class="overview-grid">
      <a class="overview-card" href="#market-chart" @click="jump('#market-chart')"><span class="card-title"><ChartNoAxesCombined :size="16" />最新价格变化<ArrowUpRight :size="14" /></span><strong :class="tone(overview.price.change)">{{ signedValue(overview.price.changePercent, 2, '%') }}</strong><p>{{ overview.price.close == null ? '暂无已收盘价格' : `${overview.price.close.toFixed(etf ? 3 : 2)} ${etf ? '元' : '点'}` }} · {{ signedValue(overview.price.change, etf ? 3 : 2, etf ? ' 元' : ' 点') }}</p><small>{{ overview.price.date ? `${overview.price.previousDate ?? '缺少基准'} → ${overview.price.date}` : '等待行情数据' }}</small><small v-if="overview.price.reason" class="pending">{{ overview.price.reason }}</small><small>{{ etf ? '未复权价格，不含现金分红' : '价格指数，不含分红再投资' }}</small></a>
      <a v-if="etf" class="overview-card" href="#portfolio-ledger" @click="jump('#portfolio-ledger')"><span class="card-title"><Wallet :size="16" />持仓盈亏变化<ArrowUpRight :size="14" /></span><strong :class="tone(overview.portfolio.change)">{{ overview.portfolio.hasEntries ? signedValue(overview.portfolio.change, 2, ' 元') : '尚未录入账本' }}</strong><p>{{ overview.portfolio.hasEntries ? `累计盈亏 ${money(overview.portfolio.totalProfit)}` : '录入真实交易，查看与自己有关的变化' }}</p><small v-if="overview.portfolio.hasEntries">{{ overview.portfolio.previousDate ?? '缺少基准' }} → {{ overview.portfolio.date ?? '等待行情' }}</small><small v-if="overview.portfolio.reason" class="pending">{{ overview.portfolio.reason }}</small><small>累计盈亏之差，含期间记账交易、费用和到账分红</small></a>
      <div v-else class="overview-card inactive"><span class="card-title"><Wallet :size="16" />持仓盈亏变化</span><strong>指数观察</strong><p>个人账本适用于 512890 ETF</p><small>在顶部证券选择中切换到 ETF 查看个人收益</small></div>
      <a class="overview-card" href="#observation-alerts" @click="jump('#observation-alerts')"><span class="card-title"><Bell :size="16" />未读提醒<ArrowUpRight :size="14" /></span><strong :class="{ attention: alerts.unreadCount }">{{ alerts.unreadCount == null ? '正在检查…' : `${alerts.unreadCount} 条` }}</strong><p>{{ alerts.ruleCount == null ? '等待提醒模块' : alerts.ruleCount ? `${alerts.activeCount ?? 0} 条条件满足 · ${alerts.pendingCount ?? 0} 条待核验` : '尚未设置条件，可添加自己的观察阈值' }}</p><small>当前证券 · 本机保存的触发记录</small><small>打开详情不会自动标为已读</small></a>
      <a class="overview-card" href="#constituent-comparison" @click="jump('#constituent-comparison')"><span class="card-title"><Layers :size="16" />最新成分变化<ArrowUpRight :size="14" /></span><strong>{{ overview.constituents.added == null ? '待积累观察' : `+${overview.constituents.added} / −${overview.constituents.removed}` }}</strong><p>{{ overview.constituents.added == null ? overview.constituents.reason : `调入 / 调出 · 更名 ${overview.constituents.renamed} 只 · 行业归属变化 ${overview.constituents.industryChanges} 只` }}</p><small>{{ overview.constituents.fromDate ? `${overview.constituents.fromDate} → ${overview.constituents.date}` : overview.constituents.date ? `基线 ${overview.constituents.date}` : '暂无成分历史' }}</small><small v-if="overview.constituents.observedAt">观察时间 {{ new Date(overview.constituents.observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }}</small><small>最近两次保存观察{{ etf ? ' · 标的指数，非 ETF 实际持仓' : '' }}</small></a>
      <a class="overview-card" href="#today-data-issues" @click="issueDetails.open = true"><span class="card-title"><CircleAlert :size="16" />数据异常与待核验<ArrowUpRight :size="14" /></span><strong :class="{ attention: overview.issues.length }">{{ overview.issues.length }} 项{{ overview.loading ? ' · 核对中' : '待查看' }}</strong><p>{{ overview.issues.length ? '查看读取失败、更新异常、旧数据及覆盖问题' : overview.loading ? '等待本页来源读取完成' : '本页已读取来源暂无异常提示' }}</p><small>按相关模块汇总，状态未知也会列出</small></a>
    </div>
    <details id="today-data-issues" ref="issueDetails" class="issue-details"><summary>查看数据异常与待核验明细（{{ overview.issues.length }} 项）</summary><ul v-if="overview.issues.length"><li v-for="issue in overview.issues" :key="issue.target"><a :href="issue.target" @click="jump(issue.target)"><strong>{{ issue.label }}<ArrowUpRight :size="13" /></strong><span>{{ issue.messages.join('；') }}</span></a></li></ul><p v-else class="overview-note">{{ overview.loading ? '正在读取，稍后更新检查结果。' : '本页已读取来源暂无异常提示。' }}</p></details>
  </section>
</template>

<style scoped>
.today-overview { padding: 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); background: linear-gradient(120deg, #10223a, #0c1423 55%); }
.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.overview-eyebrow { display: flex; align-items: center; gap: 7px; color: #9dbbe6; font-size: 11px; margin-bottom: 7px; } h2 { font-size: 18px; }
.overview-note, .overview-status { font-size: 11px; line-height: 1.8; color: #93a4bf; } .overview-note { margin-top: 8px; }
.overview-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 15px; }
.overview-card { min-width: 0; display: flex; flex-direction: column; gap: 9px; padding: 14px 12px; border: 1px solid #2b3e5b; border-radius: 8px; background: #0a1426; overflow-wrap: anywhere; }
a.overview-card:hover { border-color: #649fe7; background: #102039; } .card-title { display: flex; align-items: center; gap: 6px; color: #b7cbea; font-size: 12px; } .card-title svg:last-child { margin-left: auto; flex-shrink: 0; }
.overview-card > strong { font-size: 21px; line-height: 1.5; color: #eff3fc; font-variant-numeric: tabular-nums; } .overview-card p { font-size: 11px; line-height: 1.8; color: #b7c4d8; } .overview-card small { font-size: 10px; line-height: 1.8; color: #93a4bf; }
.overview-card .up { color: #f09699; } .overview-card .down { color: #69d9b2; } .overview-card .attention, .overview-card .pending { color: #e4bf83; } .inactive { opacity: .8; }
.issue-details { border-top: 1px solid #2b3e5b; margin-top: 16px; padding-top: 12px; font-size: 11px; color: #b7cbea; scroll-margin-top: calc(var(--header-height) + 18px); } summary { cursor: pointer; } .issue-details ul { display: grid; gap: 8px; list-style: none; padding: 0; margin-top: 12px; }
.issue-details a { display: grid; gap: 5px; padding: 9px 12px; border-radius: 5px; background: #0a1426; overflow-wrap: anywhere; line-height: 1.8; } .issue-details strong { display: flex; align-items: center; gap: 6px; color: #e4bf83; font-weight: 500; } .issue-details span { color: #acbdd5; }
a:focus-visible, summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
@media (max-width: 1350px) { .overview-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 700px) { .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .overview-card:last-child { grid-column: 1 / -1; } }
@media (max-width: 440px) { .today-overview { padding: 15px 12px; } .overview-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
