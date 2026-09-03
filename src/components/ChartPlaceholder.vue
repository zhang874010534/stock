<script setup>
import { Info, ChartNoAxesCombined } from 'lucide-vue-next'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  legends: { type: Array, default: () => [] },
})
</script>

<template>
  <section class="chart-panel panel" :aria-label="title">
    <div class="chart-heading">
      <h2 class="panel-heading">{{ title }}<Info :size="14" class="muted" aria-hidden="true" /></h2>
      <span class="reserved-badge">预留区域</span>
    </div>
    <div class="chart-legends">
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
  </section>
</template>

<style scoped>
.chart-panel { display: flex; flex-direction: column; min-height: 278px; padding: 14px 17px 13px; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.reserved-badge { flex-shrink: 0; padding: 2px 5px; border: 1px solid #273348; border-radius: 4px; color: #65738a; font-size: 9px; }
.chart-legends { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 13px; min-height: 24px; margin-top: 12px; }
.chart-legends span { display: inline-flex; align-items: center; gap: 5px; color: #8c99af; font-size: 10px; }
.chart-legends i { width: 10px; height: 5px; border-radius: 2px; opacity: .8; }
.chart-placeholder { position: relative; flex: 1; min-height: 155px; margin-top: 13px; border-left: 1px solid #26334988; border-bottom: 1px solid #26334988; background-image: linear-gradient(#24334c44 1px, transparent 1px), linear-gradient(90deg, #24334c25 1px, transparent 1px); background-size: 100% 25%, 20% 100%; }
.placeholder-label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: radial-gradient(ellipse, #0b1423e8 0%, #0b142388 38%, transparent 72%); }
.placeholder-icon { display: flex; color: #3d5477; padding-bottom: 2px; }
.placeholder-label p { color: #7d8fae; font-size: 12px; letter-spacing: .5px; }
.placeholder-label > span:last-child { color: #4f5f79; font-size: 10px; }
.chart-axis-label { position: absolute; right: 2px; bottom: 4px; font-size: 9px; color: #4b5c75; }
</style>
