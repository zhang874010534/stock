<script setup>
import { Info, ChartNoAxesCombined, CalendarDays } from 'lucide-vue-next'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  showRanges: Boolean,
  legends: { type: Array, default: () => [] },
})
const ranges = ['近1月', '近3月', '近6月', '近1年', '近3年', '近5年', '全部']
</script>

<template>
  <section class="index-chart panel" :aria-label="title">
    <div class="chart-heading">
      <h2 class="panel-heading">{{ title }}<Info :size="14" class="muted" aria-hidden="true" /></h2>
      <span class="reserved-badge">预留区域</span>
    </div>
    <div v-if="showRanges" class="chart-ranges" aria-label="时间范围筛选，后续开放">
      <button v-for="range in ranges" :key="range" disabled :class="{ 'is-selected': range === '近1年' }">{{ range }}</button>
      <CalendarDays :size="15" class="muted" aria-hidden="true" />
    </div>
    <div v-else class="chart-legends">
      <span v-for="legend in legends" :key="legend.label"><i :style="{ background: legend.color }" />{{ legend.label }}</span>
    </div>
    <div class="chart-placeholder">
      <div class="placeholder-label">
        <span class="placeholder-icon"><ChartNoAxesCombined :size="25" :stroke-width="1.2" /></span>
        <p>{{ subtitle }}</p>
        <span>完成数据接入后绘制</span>
      </div>
      <span class="chart-axis-label">时间</span>
    </div>
    <div v-if="showRanges" class="chart-range-preview" aria-hidden="true"><i /><span>时间轴预留</span><i /></div>
  </section>
</template>

<style scoped>
.index-chart { display: flex; flex-direction: column; min-height: 278px; padding: 14px 17px 13px; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.reserved-badge { flex-shrink: 0; padding: 2px 5px; border: 1px solid #273348; border-radius: 4px; color: #65738a; font-size: 9px; }
.chart-ranges { display: flex; align-items: center; gap: 0; margin-top: 12px; min-height: 24px; }
.chart-ranges button { border: 1px solid #283347; border-right: 0; background: #0c1525; color: #728098; font-size: 10px; padding: 3px 7px; white-space: nowrap; }
.chart-ranges button:first-child { border-radius: 4px 0 0 4px; }
.chart-ranges button:nth-last-child(2) { border-right: 1px solid #283347; border-radius: 0 4px 4px 0; }
.chart-ranges button.is-selected { color: #84a8e8; background: #1e345b; border-color: #35598e; }
.chart-ranges svg { flex-shrink: 0; margin-left: 9px; }
.chart-legends { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 13px; min-height: 24px; margin-top: 12px; }
.chart-legends span { display: inline-flex; align-items: center; gap: 5px; color: #8c99af; font-size: 10px; }
.chart-legends i { width: 10px; height: 5px; border-radius: 2px; opacity: .8; }
.chart-placeholder { position: relative; flex: 1; min-height: 155px; margin-top: 13px; border-left: 1px solid #26334988; border-bottom: 1px solid #26334988; background-image: linear-gradient(#24334c44 1px, transparent 1px), linear-gradient(90deg, #24334c25 1px, transparent 1px); background-size: 100% 25%, 20% 100%; }
.placeholder-label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: radial-gradient(ellipse, #0b1423e8 0%, #0b142388 38%, transparent 72%); }
.placeholder-icon { display: flex; color: #3d5477; padding-bottom: 2px; }
.placeholder-label p { color: #7d8fae; font-size: 12px; letter-spacing: .5px; }
.placeholder-label > span:last-child { color: #4f5f79; font-size: 10px; }
.chart-axis-label { position: absolute; right: 2px; bottom: 4px; font-size: 9px; color: #4b5c75; }
.chart-range-preview { display: flex; align-items: center; justify-content: space-between; height: 18px; margin-top: 11px; background: #18243977; border: 1px solid #293852; border-radius: 3px; font-size: 9px; color: #53637d; }
.chart-range-preview i { width: 3px; height: 14px; border: 1px solid #607089; border-radius: 1px; }
@media (max-width: 420px) { .chart-ranges button { padding-inline: 5px; } }
</style>
