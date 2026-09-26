<script setup>
import { computed, onMounted, ref } from 'vue'
import { getLatestMetrics } from '../api/latestMetrics.js'
import { DIVIDEND_SOURCE, formatLatestMetric } from '../utils/latestMetrics.js'
import { VALUATION_SOURCE } from '../api/valuations.js'

const props = defineProps({ instrument: { type: String, default: 'H30269' } })
const data = ref(null)
const loading = ref(true)
const error = ref(false)
const title = computed(() => props.instrument === '512890' ? '标的指数最新指标' : '最新指标')
const rows = [
  { key: 'pe', label: '市盈率 PE' },
  { key: 'pb', label: '市净率 PB' },
  { key: 'dividendYield', label: '股息率', note: '中证 · 总股本口径' },
  { key: 'annualReturn', label: '年化收益率', performance: true },
  { key: 'maxDrawdown', label: '最大回撤', performance: true },
  { key: 'sharpe', label: '夏普比率', performance: true, note: '无风险利率假设 0%' },
]

async function load() {
  if (loading.value && data.value) return
  loading.value = true
  error.value = false
  try { data.value = await getLatestMetrics() }
  catch { error.value = true }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <section class="latest-metrics" :aria-label="title" :aria-busy="loading">
    <div class="metrics-heading">
      <h3>{{ title }}</h3>
      <button type="button" :disabled="loading" aria-label="刷新最新指标" @click="load">{{ loading ? '读取中…' : error ? '重试' : '刷新' }}</button>
    </div>
    <p class="metrics-context">H30269 · 中证红利低波动指数</p>
    <p v-if="instrument === '512890'" class="metrics-context">以下为标的指数数据，非 ETF 自身表现或实际分红收益率。</p>
    <p v-if="error" class="metrics-status" role="status">指标读取失败{{ data ? '，保留上次数据及日期。' : '，请重试。' }}</p>
    <p v-else-if="loading" class="metrics-context" role="status">{{ data ? '正在刷新指标…' : '正在读取最新指标…' }}</p>
    <dl class="metrics-list">
      <div v-for="row in rows" :key="row.key" class="metric-row">
        <dt>{{ row.label }}<span v-if="row.performance" class="metric-period">全部历史</span></dt>
        <dd class="metric-value">{{ formatLatestMetric(data?.metrics[row.key]) }}</dd>
        <dd class="metric-meta">
          <span v-if="row.note" class="metric-note">{{ row.note }}</span>
          <span v-if="data?.metrics[row.key].asOf">截至 {{ data.metrics[row.key].asOf }}</span>
          <span v-else>{{ loading ? '读取中…' : '暂无数据' }}</span>
          <span v-if="data?.metrics[row.key].status === 'stale'" class="metrics-status">更新失败，保留上次数据</span>
          <span v-else-if="data?.metrics[row.key].status === 'unavailable'" class="metrics-status">{{ data.metrics[row.key].reason }}</span>
        </dd>
      </div>
    </dl>
    <div class="metrics-footer">
      <p>全部历史 · 价格指数（不含分红再投资）</p>
      <p v-if="data?.calculation">计算区间：{{ data.calculation.windowStart }} — {{ data.calculation.windowEnd }}</p>
      <p v-else>计算区间：暂无</p>
      <p>按当前已同步的全部历史计算，不代表指数成立以来。</p>
      <p v-if="data?.calculation && data.calculation.calendarDays < 365">历史不足一年，年化结果仅供参考。</p>
      <p><a :href="VALUATION_SOURCE" target="_blank" rel="noopener noreferrer">PE / PB：东方财富 / 天天基金</a></p>
      <p>来源未明确财报及聚合口径。</p>
      <p><a :href="DIVIDEND_SOURCE" target="_blank" rel="noopener noreferrer">股息率：中证指数 D/P1</a></p>
    </div>
    <details class="metrics-help">
      <summary>查看指标说明</summary>
      <dl>
        <dt>市盈率 PE / 市净率 PB</dt>
        <dd>采用东方财富／天天基金提供的指数估值。来源未明确财报周期及成分股聚合方式，因此不标为 TTM 或 MRQ。</dd>
        <dt>股息率</dt>
        <dd>采用中证指数 D/P1，总股本口径。展示来源发布的股息率，不代表 ETF 实际分红收益率，也不是未来收益承诺。</dd>
        <dt>年化收益率</dt>
        <dd>按全部历史首尾收盘价计算复合年化收益：（末日收盘价 ÷ 首日收盘价）^(365 ÷ 实际自然日数) − 1。不是每日收益的简单平均。</dd>
        <dt>最大回撤</dt>
        <dd>全部历史中，从先前最高收盘价跌至后续收盘价的最大跌幅，以正百分比展示。只使用收盘价，不使用日内最低价。</dd>
        <dt>夏普比率</dt>
        <dd>日简单收益的平均值 ÷ 日收益样本标准差 × √252。无风险利率固定假设为 0%，不使用下方十年期国债收益率。结果没有百分号；样本不足或波动为零时显示“—”。</dd>
        <dt>统计范围和日期</dt>
        <dd>三项收益风险指标使用当前已同步的全部 H30269 历史，不随左侧 K 线周期或缩放变化，不代表指数成立以来。补入更早历史会重算；不同起点的结果不宜直接比较。价格指数不含分红再投资。</dd>
        <dt>更新和异常</dt>
        <dd>各项保留原始数据日期，来源日期可能不同。“刷新”只重新读取已生成的指标。更新失败时保留旧值及原区间并标明状态；无可用值时显示“—”及原因。</dd>
      </dl>
    </details>
  </section>
</template>

<style scoped>
.latest-metrics { container-type: inline-size; min-width: 0; margin-top: 14px; padding-top: 14px; border-top: 1px solid #30333e; }
.metrics-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
h3 { color: #dfe5f1; font-size: 14px; font-weight: 600; }
button { padding: 3px 7px; border: 1px solid #383d49; border-radius: 4px; background: #20232c; color: #b8c7dd; font: inherit; font-size: 11px; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
button:focus-visible, a:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
.metrics-context, .metrics-footer { color: #959baa; font-size: 11px; line-height: 1.65; overflow-wrap: anywhere; }
.metrics-context { margin-top: 5px; }
.metrics-list { display: grid; grid-template-columns: minmax(0, 1fr); margin: 9px 0 0; }
.metric-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: 8px; padding: 9px 0; border-bottom: 1px solid #252832; }
dt { color: #bfc5d2; font-size: 12px; line-height: 1.6; }
dd { margin: 0; }
.metric-period { margin-left: 5px; font-size: 10px; color: #8993a5; white-space: nowrap; }
.metric-value { color: #e1e8f3; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.metric-meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0 8px; margin-top: 3px; color: #8993a5; font-size: 10px; line-height: 1.6; overflow-wrap: anywhere; }
.metric-note { color: #a6b8c9; }
.metrics-status { color: #dab57b; font-size: 11px; line-height: 1.6; }
.metrics-footer { margin-top: 10px; }
a { color: #8ba8cd; text-decoration: underline; text-underline-offset: 3px; }
.metrics-help { margin-top: 10px; color: #a6b8c9; font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.metrics-help summary { cursor: pointer; color: #8ba8cd; }
.metrics-help summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
.metrics-help dt { margin-top: 9px; font-weight: 600; }
.metrics-help dd { margin-top: 3px; color: #959baa; }
@container (min-width: 480px) {
  .metrics-list { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 22px; }
}
</style>
