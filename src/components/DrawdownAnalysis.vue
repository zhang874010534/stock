<script setup>
import { computed } from 'vue'
import DrawdownTrend from './DrawdownTrend.vue'
import { calculateDrawdown, formatDrawdown } from '../utils/drawdown.js'
import { formatIndexValue } from '../utils/indexHistory.js'

const props = defineProps({ instrument: { type: String, default: '512890' }, history: { type: Array, default: () => [] },
  loading: Boolean, error: String, backfillCompleted: Boolean, collectionNotice: String, collectionWarning: Boolean })
defineEmits(['retry'])
const result = computed(() => {
  try { return { stats: calculateDrawdown(props.history), error: '' } }
  catch (error) { return { stats: null, error: error.message } }
})
const stats = computed(() => result.value.stats)
const ready = computed(() => Boolean(stats.value?.current))
const current = computed(() => stats.value?.current)
const maximum = computed(() => stats.value?.maximum)
const isEtf = computed(() => props.instrument === '512890')
const price = value => `${formatIndexValue(value, isEtf.value ? 3 : 2)} ${isEtf.value ? '元' : '点'}`
</script>

<template>
  <section class="drawdown-analysis panel" :aria-label="`${instrument}回撤分析`" :aria-busy="loading">
    <div class="drawdown-heading"><h2>回撤曲线</h2><span>{{ instrument }} · {{ isEtf ? 'ETF' : '指数' }}日线收盘</span></div>
    <p class="drawdown-note">{{ isEtf ? 'ETF 未复权价格，不含现金分红；除息也可能表现为回撤。' : '价格指数，不含分红再投资。' }}</p>
    <p v-if="collectionNotice" class="drawdown-note" :class="{ 'drawdown-status': collectionWarning }">行情来源：{{ collectionNotice }}</p>
    <p v-if="error" class="drawdown-status" role="status">行情读取失败{{ ready ? '，保留上次回撤曲线与原日期。' : '，暂无可用回撤曲线。' }}<button type="button" :disabled="loading" @click="$emit('retry')">重新读取</button></p>
    <p v-else-if="loading" class="drawdown-note" role="status">{{ ready ? '正在重新读取行情，暂显示上次回撤。' : '正在读取行情…' }}</p>
    <p v-if="result.error" class="drawdown-status" role="status">无法计算回撤：{{ result.error }}</p>
    <p v-else-if="!ready && !loading" class="drawdown-note">{{ stats?.count === 1 ? '仅有一个收盘样本，暂不足以判断回撤。' : '暂无可用收盘行情。' }}</p>
    <template v-if="ready">
      <dl class="drawdown-summary">
        <div class="drawdown-metric">
          <dt>当前回撤</dt><dd class="drawdown-value">{{ formatDrawdown(current.value) }}</dd>
          <dd class="drawdown-meta">截至 {{ stats.endDate }} · 收盘 {{ price(current.close) }}</dd>
          <dd v-if="current.value < 0" class="drawdown-meta">距 {{ current.peakDate }} 高点 {{ price(current.peakClose) }}<br/>尚未恢复 · 已持续 {{ current.days }} 个自然日</dd>
          <dd v-else class="drawdown-meta">当前收盘达到已同步历史最高点。</dd>
        </div>
        <div class="drawdown-metric">
          <dt>最大回撤</dt><dd class="drawdown-value">{{ formatDrawdown(maximum?.value ?? 0) }}</dd>
          <dd v-if="maximum" class="drawdown-meta">高点 {{ maximum.peakDate }} · {{ price(maximum.peakClose) }}<br/>低点 {{ maximum.troughDate }} · {{ price(maximum.troughClose) }}</dd>
          <dd v-else class="drawdown-meta">已同步收盘样本中未发生回撤。</dd>
        </div>
        <div class="drawdown-metric">
          <dt>最大回撤恢复情况</dt><dd class="drawdown-recovery">{{ maximum ? maximum.recoveryDate ? '已恢复' : '尚未恢复' : '无需恢复' }}</dd>
          <dd v-if="maximum?.recoveryDate" class="drawdown-meta">{{ maximum.recoveryDate }} 收盘首次回到原高点<br/>高点至恢复共 {{ maximum.days }} 个自然日</dd>
          <dd v-else-if="maximum" class="drawdown-meta">截至 {{ stats.endDate }}，尚未回到原高点<br/>高点至今 {{ maximum.days }} 个自然日</dd>
          <dd v-else class="drawdown-meta">已同步收盘价保持在历史高点。</dd>
        </div>
      </dl>
      <DrawdownTrend :key="instrument" :stats="stats" :instrument="instrument" />
      <p class="drawdown-note">滑块或拖动只改变查看区间；高点和摘要始终按全部已同步历史计算。</p>
    </template>
    <div class="drawdown-footer">
      <p v-if="stats?.count">已同步历史：{{ stats.startDate }} — {{ stats.endDate }} · {{ stats.count }} 个日线收盘样本。{{ backfillCompleted ? '' : '历史仍在补充。' }}</p>
      <p>回撤 = 收盘价 ÷ 截至当日最高收盘价 − 1；曲线低于 0 表示距高点的跌幅。最大回撤区间为高点至低点，恢复以已同步样本中首次收盘达到原高点为准。</p>
      <p>仅依据已同步收盘样本，不填补缺失交易日，不代表成立以来或盘中最大回撤。收益风险摘要为 H30269 已保存指标，证券、范围或截止日期可能不同。</p>
    </div>
  </section>
</template>

<style scoped>
.drawdown-analysis { min-width: 0; padding: 18px 20px; }
.drawdown-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.drawdown-heading h2 { font-size: 15px; }
.drawdown-heading span, .drawdown-note, .drawdown-footer { color: #93a4bf; font-size: 11px; line-height: 1.7; }
.drawdown-note, .drawdown-status { margin-top: 7px; }
.drawdown-status { color: #d5b57f; font-size: 11px; line-height: 1.7; }
.drawdown-status button { margin-left: 8px; padding: 0; border: 0; color: #9bc5ff; background: transparent; text-decoration: underline; }
.drawdown-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.drawdown-metric { padding: 14px; border: 1px solid #223049; border-radius: 9px; background: #0a1220; }
.drawdown-metric dt { color: #acbcd3; font-size: 12px; }
.drawdown-value { font: 600 25px var(--font-mono); color: #f08c9c; margin-top: 8px; }
.drawdown-recovery { color: #c7d8f2; font-size: 20px; font-weight: 600; margin-top: 8px; }
.drawdown-meta { margin-top: 8px; color: #93a4bf; font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.drawdown-footer { padding-top: 10px; border-top: 1px solid #223049; }
.drawdown-footer p + p { margin-top: 5px; }
@media (max-width: 700px) { .drawdown-analysis { padding: 15px 12px; } .drawdown-summary { grid-template-columns: minmax(0, 1fr); gap: 9px; } }
</style>
