<script setup>
import { computed, onMounted, ref } from 'vue'
import { ArrowUpRight, Database, Clock3, ShieldCheck, ChartColumn, Globe2, ScanLine, PieChart, Grid2X2, ArrowRight } from 'lucide-vue-next'
import MetricCard from '../components/MetricCard.vue'
import IndexChart from '../components/IndexChart.vue'
import ChartPlaceholder from '../components/ChartPlaceholder.vue'
import { getH30269 } from '../api/h30269.js'
import { formatIndexValue } from '../utils/indexHistory.js'

const data = ref(null)
const loading = ref(true)
const error = ref('')
const history = computed(() => data.value?.history ?? [])
const latest = computed(() => history.value.at(-1))
const syncLabel = computed(() => {
  if (loading.value) return '正在读取行情'
  if (error.value) return '行情暂时无法读取'
  if (data.value?.sync?.status === 'paused') return '同步已暂停'
  if (data.value?.sync?.status === 'failed') return '更新失败，等待后续同步'
  if (!history.value.length) return '等待首次同步'
  return data.value?.sync?.historyComplete ? '每日更新' : '历史数据逐步补齐'
})
const updatedAt = computed(() => {
  const time = Date.parse(data.value?.updatedAt)
  return Number.isFinite(time) ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(time) : '—'
})

async function loadHistory() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getH30269()
  } catch {
    error.value = '行情加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
onMounted(loadHistory)

// 仅日线接入真实数据；估值、股息率需要各自的数据来源和计算口径。
const metrics = computed(() => [
  { title: '指数点位', value: formatIndexValue(latest.value?.close), description: '最新收盘点位', period: `交易日期：${latest.value?.date ?? '—'}`, accent: 'blue' },
  { title: '股息率', description: '近12个月股息率', period: '近12个月', accent: 'cyan' },
  { title: 'PE (TTM)', description: '滚动市盈率', period: '近12个月', accent: 'cyan' },
  { title: 'PB', description: '市净率', period: '近12个月', accent: 'purple' },
  { title: '历史分位', description: '历史区间相对位置', period: '近5年 · 口径待确认', accent: 'purple' },
])
const futureModules = [
  { title: '行业分析', subtitle: '行业分布与轮动', icon: ChartColumn, accent: 'cyan' },
  { title: '宏观环境', subtitle: '宏观观察与流动性', icon: Globe2, accent: 'purple' },
  { title: '回测工具', subtitle: '策略回测与绩效', icon: ScanLine, accent: 'cyan' },
  { title: '组合配置', subtitle: '组合构建与优化', icon: PieChart, accent: 'blue' },
  { title: '更多模块', subtitle: '持续扩展中', icon: Grid2X2, accent: 'blue' },
]
</script>

<template>
  <div class="dashboard">
    <section class="index-banner panel" aria-labelledby="index-title">
      <div class="banner-copy">
        <div class="banner-eyebrow"><span class="status-dot" />红利低波 · 指数观察</div>
        <h1 id="index-title"><span class="mono">H30269</span> 中证红利低波动指数</h1>
        <p>以长期视角，观察红利与低波动的价值。</p>
      </div>
      <div class="banner-meta"><span class="preview-badge">{{ history.length ? '真实日线' : '行情同步' }}</span><span>{{ syncLabel }}</span></div>
      <span class="banner-watermark" aria-hidden="true">H30269</span>
    </section>

    <section class="metrics-grid" aria-label="指数关键指标">
      <MetricCard v-for="metric in metrics" :key="metric.title" v-bind="metric" />
      <MetricCard title="信号状态" description="等待数据与计算规则" period="基于多因子综合信号" signal />
    </section>

    <section class="charts-grid" aria-label="指数分析图表">
      <IndexChart :history="history" :loading="loading" :error="error" @retry="loadHistory" />
      <ChartPlaceholder title="股息率与历史分位" subtitle="股息率与历史分位对照" :legends="[{ label: '股息率（近12个月）', color: '#22c6d8' }, { label: '历史分位（近5年，右轴）', color: '#a574ed' }]" />
      <ChartPlaceholder title="估值区间观察（PE-TTM）" subtitle="估值水平与区间分布" :legends="[{ label: '极低区间', color: '#6467dc' }, { label: '低估区间', color: '#26a7d0' }, { label: '合理区间', color: '#3b9d85' }, { label: '偏高区间', color: '#d09648' }, { label: '高估区间', color: '#c95e51' }]" />
    </section>

    <section class="bottom-grid" aria-label="说明与未来功能预留区">
      <article class="data-notes panel">
        <h2 class="panel-heading">数据说明 / 更新说明</h2>
        <div class="note-row"><Database :size="16" /><p>日线来源：<strong>中证指数</strong>。<template v-if="history.length">已收录 {{ history[0].date }} 至 {{ latest.date }}，共 {{ history.length }} 条。</template><template v-else>等待首次同步后展示真实走势。</template></p></div>
        <div class="note-row"><Clock3 :size="16" /><p>每日北京时间 18:00 同步近期行情，并逐步补齐历史数据。估值与股息率待接入。</p></div>
        <div v-if="data?.sync?.lastError" class="note-row"><Clock3 :size="16" /><p>{{ data.sync.lastError }}</p></div>
        <div class="note-row"><ShieldCheck :size="16" /><p>指标及信号仅供研究参考，不构成投资建议。</p></div>
        <div class="notes-footer"><span>最近同步：<span class="mono">{{ updatedAt }}</span></span><span class="pending-data"><i />{{ syncLabel }}</span></div>
      </article>

      <article class="future-panel panel">
        <div class="future-heading"><div><h2 class="panel-heading">未来功能预留</h2><p>更多研究工具，逐步完善</p></div><span>规划中<ArrowUpRight :size="13" /></span></div>
        <div class="future-modules">
          <button v-for="module in futureModules" :key="module.title" class="future-module" :class="`module-${module.accent}`" disabled :aria-label="`${module.title}，规划中`">
            <component :is="module.icon" :size="31" :stroke-width="1.5" />
            <strong>{{ module.title }}</strong><span>{{ module.subtitle }}</span>
          </button>
        </div>
      </article>

      <article class="brand-panel panel">
        <span class="brand-kicker">LONG-TERM PERSPECTIVE</span>
        <h2>专注红利低波，<br />追求长期稳健</h2>
        <p>用数据洞察价值，用理性把握机会。</p>
        <span class="brand-footer">长期视角<span />理性观察<ArrowRight :size="15" /></span>
      </article>
    </section>
  </div>
</template>

<style scoped>
.dashboard { display: grid; grid-template-rows: 132px auto minmax(278px, 1fr) auto; gap: var(--space-grid); min-height: calc(100svh - var(--header-height) - 36px); }
.index-banner { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; overflow: hidden; padding: 22px 28px; background: radial-gradient(ellipse at 94% 100%, #16458565, transparent 58%), linear-gradient(105deg, #11182d, #091326 65%, #0c1b36); }
.index-banner::after { content: ''; position: absolute; inset: 0 0 0 48%; background-image: linear-gradient(#4972b218 1px, transparent 1px), linear-gradient(90deg, #4972b218 1px, transparent 1px); background-size: 32px 32px; mask-image: linear-gradient(90deg, transparent, #000); pointer-events: none; }
.banner-copy, .banner-meta { position: relative; z-index: 1; }
.banner-eyebrow { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; color: #8ca5ce; font-size: 10px; letter-spacing: 2px; }
.status-dot { width: 5px; height: 5px; border-radius: 50%; background: #5c97ff; box-shadow: 0 0 10px #4c8dff77; }
.index-banner h1 { font-size: clamp(22px, 1.9vw, 34px); line-height: 1.35; letter-spacing: .5px; font-weight: 650; }
.index-banner h1 .mono { margin-right: 7px; font-weight: 650; letter-spacing: .2px; }
.index-banner p { margin-top: 10px; color: #97a5c0; font-size: 12px; letter-spacing: .6px; }
.banner-meta { display: flex; flex-direction: column; align-items: flex-end; align-self: flex-start; gap: 8px; padding-top: 1px; color: #647d9e; font-size: 9px; letter-spacing: 1px; white-space: nowrap; }
.preview-badge { padding: 4px 8px; background: #172d4c; border: 1px solid #294569; border-radius: 4px; color: #94b9ee; font-size: 10px; }
.banner-watermark { position: absolute; right: 2%; bottom: -33px; font-family: var(--font-mono); font-size: 116px; font-weight: 700; color: #38629a0f; letter-spacing: -5px; pointer-events: none; }
.metrics-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--space-grid); }
.charts-grid { display: grid; grid-template-columns: 1.08fr 1fr 1.08fr; gap: var(--space-grid); }
.bottom-grid { display: grid; grid-template-columns: .95fr 1.6fr 1.2fr; gap: var(--space-grid); }
.data-notes, .future-panel, .brand-panel { padding: 15px 18px; min-height: 214px; }
.data-notes { display: flex; flex-direction: column; }
.note-row { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; font-size: 10px; line-height: 1.65; color: #8695af; }
.note-row svg { flex-shrink: 0; margin-top: 1px; color: #91a4c5; }
.note-row strong { font-weight: 500; color: #9ab5df; }
.notes-footer { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-top: auto; padding-top: 13px; color: #5d6d87; font-size: 10px; }
.pending-data { display: flex; align-items: center; gap: 5px; }
.pending-data i { width: 4px; height: 4px; background: #5f7394; border-radius: 50%; }
.future-panel { background: linear-gradient(130deg, #0c1423, #0c19314f); border-style: dashed; }
.future-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.future-heading p { margin-top: 4px; font-size: 11px; color: #6f7f9a; }
.future-heading > span { display: flex; align-items: center; gap: 3px; margin-top: 2px; font-size: 10px; color: #667692; }
.future-modules { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.future-module { display: flex; flex-direction: column; align-items: center; gap: 7px; min-width: 0; min-height: 117px; padding: 15px 4px 10px; border: 1px solid #2a3852; border-radius: 11px; background: linear-gradient(140deg, #14203988, #0c152a33); }
.future-module svg { margin-bottom: 4px; color: #7096ee; }
.future-module strong { color: #b3c0d7; font-size: 12px; font-weight: 500; white-space: nowrap; }
.future-module span { color: #60718d; font-size: 9px; white-space: nowrap; }
.module-cyan svg { color: #45bfd6; }
.module-purple svg { color: #ae83eb; }
.brand-panel { display: flex; flex-direction: column; position: relative; overflow: hidden; padding: 21px 22px; background: radial-gradient(ellipse at 105% 115%, #3b2b8770, transparent 63%), radial-gradient(ellipse at 90% 25%, #14386b4f, transparent 64%), #0b1226; }
.brand-kicker { color: #516c9b; font-family: var(--font-mono); font-size: 9px; letter-spacing: 2px; }
.brand-panel h2 { margin-top: 10px; color: #c9dafb; font-size: 21px; line-height: 1.5; letter-spacing: 1px; }
.brand-panel p { margin-top: 9px; color: #8596b2; font-size: 11px; }
.brand-footer { display: flex; align-items: center; gap: 11px; margin-top: auto; padding-top: 14px; color: #6b96d9; font-size: 10px; letter-spacing: .7px; }
.brand-footer span { height: 9px; width: 1px; background: #345588; }
.brand-footer svg { margin-left: auto; }
@media (min-width: 1750px) {
  .note-row { font-size: 12px; }
  .future-module span { font-size: 10px; }
  .brand-panel h2 { font-size: 24px; }
  .brand-panel p { font-size: 13px; }
}
@media (max-width: 1390px) {
  .metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .bottom-grid { grid-template-columns: 1fr 1.55fr; }
  .brand-panel { grid-column: 1 / -1; min-height: 175px; }
  .brand-panel h2 br { display: none; }
  .brand-panel h2 { margin-top: 8px; }
}
@media (max-width: 1200px) {
  .charts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .charts-grid > :last-child { grid-column: 1 / -1; }
  .banner-meta { display: none; }
  .index-banner { padding-inline: 22px; }
}
@media (max-width: 640px) {
  .dashboard { grid-template-rows: auto auto auto auto; }
  .index-banner { min-height: 144px; padding: 20px; }
  .index-banner h1 { font-size: 20px; }
  .index-banner h1 .mono { display: block; margin-bottom: 2px; font-size: 23px; }
  .index-banner p { font-size: 10px; letter-spacing: 0; }
  .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .charts-grid, .bottom-grid { grid-template-columns: minmax(0, 1fr); }
  .charts-grid > :last-child, .brand-panel { grid-column: auto; }
  .future-modules { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .data-notes { min-height: 200px; }
  .note-row { font-size: 12px; }
  .future-panel, .brand-panel { padding: 18px; }
}
</style>
