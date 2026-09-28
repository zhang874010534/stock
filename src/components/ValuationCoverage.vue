<script setup>
import { computed } from 'vue'
import { MIN_VALUATION_SAMPLES, VALUATION_RANGES, valuationCoverage } from '../utils/valuationStats.js'

const props = defineProps({ stats: { type: Object, required: true }, range: { type: String, default: 'all' },
  title: { type: String, default: '历史积累与覆盖' }, loading: Boolean, error: String })
const coverage = computed(() => valuationCoverage(props.stats))
</script>

<template>
  <section class="coverage" :aria-label="title" :aria-busy="loading">
    <div class="coverage-heading"><h4>{{ title }}</h4><span>{{ VALUATION_RANGES[range] }}</span></div>
    <p v-if="loading && !stats.count" class="coverage-note" role="status">正在读取积累进度…</p>
    <template v-else>
      <p class="sample-count"><strong>{{ stats.count }}</strong> 个有效日样本 <span>{{ coverage.remaining ? '历史积累中' : '已达最低计算门槛' }}</span></p>
      <p class="coverage-dates">实际覆盖：{{ coverage.firstDate ?? '暂无' }} — {{ coverage.lastDate ?? '暂无' }}</p>
      <p v-if="stats.count" class="coverage-note">日期跨度 {{ coverage.calendarDays }} 个自然日；不表示期间每个交易日均有数据。</p>
      <div class="progress-heading"><span>分位计算样本进度</span><span>{{ coverage.progress }} / {{ MIN_VALUATION_SAMPLES }}</span></div>
      <progress :value="coverage.progress" :max="MIN_VALUATION_SAMPLES" :aria-label="`${title}分位计算样本进度`" />
      <p v-if="coverage.remaining" class="coverage-note">{{ stats.count ? `还需 ${coverage.remaining} 个有效日样本，暂不计算分位。` : '暂无可用历史；积累至少 20 个有效日样本后计算分位。' }}</p>
      <p v-else class="coverage-note">仅达到 {{ MIN_VALUATION_SAMPLES }} 个样本的最低计算门槛，不代表长期估值水平。</p>
      <p v-if="stats.partial" class="coverage-note">尚未覆盖所选{{ VALUATION_RANGES[range] }}，仅统计实际已积累样本。</p>
      <p class="coverage-note">进度仅表示样本门槛，不是历史完整率；不代表成立以来历史。</p>
    </template>
    <p v-if="loading && stats.count" class="coverage-note" role="status">正在重新读取，暂显示已保存的覆盖范围。</p>
    <p v-if="error" class="coverage-error" role="status">{{ error }}</p>
  </section>
</template>

<style scoped>
.coverage { min-width: 0; padding: 14px; border: 1px solid #2a3b55; border-radius: 8px; background: #101e302e; }
.coverage-heading { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; }
h4 { margin: 0; color: #c3d0e3; font-size: 12px; font-weight: 500; }
.coverage-heading span, .coverage-note, .coverage-error, .coverage-dates, .progress-heading { font-size: 11px; line-height: 1.8; }
.coverage-heading span, .coverage-note { color: #95a7c1; }
.sample-count { margin: 10px 0 6px; color: #b8c7dd; font-size: 12px; }
.sample-count strong { font: 600 28px var(--font-mono); color: #c3d7fa; }
.sample-count span { display: inline-block; margin-left: 8px; color: #a6bedf; font-size: 11px; }
.coverage-dates { color: #c3d0e3; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.progress-heading { display: flex; justify-content: space-between; gap: 10px; margin-top: 12px; color: #a6bedf; }
progress { display: block; width: 100%; height: 6px; margin: 5px 0 9px; border: 0; border-radius: 4px; overflow: hidden; background: #25334b; color: #739ce5; accent-color: #739ce5; }
progress::-webkit-progress-bar { background: #25334b; }
progress::-webkit-progress-value { background: #739ce5; }
progress::-moz-progress-bar { background: #739ce5; }
.coverage-error { color: #dab57b; margin-top: 7px; }
</style>
