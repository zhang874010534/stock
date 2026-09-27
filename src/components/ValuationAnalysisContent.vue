<script setup>
import { VALUATION_RANGES } from '../utils/valuationStats.js'
import ValuationTrend from './ValuationTrend.vue'

defineProps({ source: String, metric: String, basis: String, range: String, stats: Object, data: Object,
  loading: Boolean, error: String, statusNotice: String, lastSuccess: String, instrument: String, expanded: Boolean, sourceUrl: String })
defineEmits(['update:source', 'update:metric', 'update:basis', 'update:range', 'retry'])
const format = value => value == null ? '—' : value.toFixed(2)
</script>

<template>
  <div class="valuation-content">
    <div class="controls">
      <select :value="source" aria-label="估值数据来源" @change="$emit('update:source', $event.target.value)">
        <option value="csi">中证官方</option><option value="eastmoney">东方财富</option>
      </select>
      <select :value="range" aria-label="估值统计范围" @change="$emit('update:range', $event.target.value)">
        <option v-for="(label, key) in VALUATION_RANGES" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>
    <div v-if="source === 'csi'" class="controls">
      <span class="caption">市盈率 PE</span>
      <select :value="basis" aria-label="中证PE口径" @change="$emit('update:basis', $event.target.value)">
        <option value="total">总股本口径</option><option value="calculation">计算用股本口径</option>
      </select>
    </div>
    <div v-else class="controls" role="group" aria-label="估值指标">
      <button v-for="(label, key) in { pe: '市盈率', pb: '市净率' }" :key="key" :aria-pressed="metric === key" @click="$emit('update:metric', key)">{{ label }}</button>
    </div>
    <p class="caption">{{ source === 'csi' ? `中证 · ${basis === 'total' ? '总股本 P/E1' : '计算用股本 P/E2'}` : '东方财富 · 来源未明确财报及聚合口径' }}</p>
    <p class="current">{{ metric.toUpperCase() }} {{ format(stats.latest?.value) }} 倍</p>
    <p class="caption">{{ range === 'all' || stats.partial ? '已积累区间分位' : '所选区间分位' }} {{ stats.rank == null ? '—' : `${format(stats.rank)}%` }}</p>
    <div class="levels"><span>70%分位值 {{ format(stats.high) }}</span><span>30%分位值 {{ format(stats.low) }}</span></div>
    <p v-if="loading" class="caption" role="status">正在读取估值历史…</p>
    <p v-if="error" class="notice" role="status">{{ error }}</p>
    <p v-if="statusNotice" class="notice" role="status">{{ statusNotice }}</p>
    <button v-if="error || statusNotice" :disabled="loading" @click="$emit('retry')">重新读取</button>
    <ValuationTrend v-if="stats.count" :stats="stats" :metric="metric" :expanded="expanded" />
    <p v-else-if="!loading" class="empty">暂无可用估值历史</p>
    <p class="caption">实际样本：{{ stats.points[0]?.date ?? '—' }} — {{ stats.latest?.date ?? '—' }} · {{ stats.count }} 个交易日</p>
    <p v-if="stats.partial" class="notice">历史不足所选范围，仅统计实际已积累样本。</p>
    <p v-if="stats.count < 20" class="notice">样本不足 20 个，暂不计算分位。</p>
    <p class="caption">历史积累中，不代表完整历史；窗口外缺失日期不会填补。</p>
    <p v-if="source === 'csi'" class="caption">最后成功获取：{{ lastSuccess || '尚无成功记录' }}</p>
    <p class="caption"><a :href="sourceUrl" target="_blank" rel="noopener noreferrer">来源：{{ source === 'csi' ? '中证指数' : '东方财富 / 天天基金' }}</a> · 截至 {{ data?.date ?? '—' }}</p>
    <p v-if="source === 'csi'" class="caption">上方最新 PE/PB 为东方财富口径，可能与本图不同；中证文件不提供 PB。</p>
    <p v-if="instrument === '512890'" class="caption">H30269 标的指数估值，非 ETF 自身估值。</p>
    <div v-if="expanded" class="methodology">
      <p>30% / 70% 分位值按有效交易日等权、排序后线性插值计算。区间分位 =（小于当前值的样本数 + 等于当前值的样本数 × 0.5）÷ 样本数 × 100%。</p>
      <p>滑块只缩放图表，不改变统计区间；与行情 K 线独立。分位不代表上涨概率，短期样本不代表长期估值水平。</p>
      <p v-if="source === 'csi'">P/E1 使用总股本口径，P/E2 使用计算用股本口径，均按官方文件字段展示，不自行重算。财报周期及与 factsheet 滚动 PE 的对应关系尚待确认，不标为 TTM。两种口径与东方财富历史分别保存、分别统计。</p>
      <p v-else>来源未明确财报及聚合口径，不标为 TTM / MRQ；历史来自已保存的东方财富每日快照。</p>
    </div>
  </div>
</template>

<style scoped>
.controls { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin: 10px 0; flex-wrap: wrap; }
button, select { max-width: 100%; padding: 5px 7px; color: #b8c7dd; border: 1px solid #383d49; background: #20232c; border-radius: 4px; font: inherit; font-size: 11px; cursor: pointer; }
button[aria-pressed=true] { background: #193741; color: #67d5df; border-color: #386779; }
button:disabled { opacity: .5; }
button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
.current { color: #709bff; font-size: 17px; line-height: 1.8; font-variant-numeric: tabular-nums; }
.levels { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; line-height: 1.8; }
.levels span:first-child { color: #ef697c; } .levels span:last-child { color: #34c79a; }
.caption, .methodology { font-size: 11px; color: #959baa; line-height: 1.8; }
.notice { font-size: 11px; color: #dab57b; line-height: 1.8; }
.empty { padding: 55px 0; text-align: center; color: #959baa; font-size: 12px; }
.methodology { border-top: 1px solid #30333e; margin-top: 12px; padding-top: 10px; }
a { color: #8ba8cd; }
</style>
