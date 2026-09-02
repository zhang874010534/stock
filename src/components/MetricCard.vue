<script setup>
import { Info, ChartNoAxesCombined } from 'lucide-vue-next'

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  period: { type: String, default: '' },
  accent: { type: String, default: 'blue' },
  signal: Boolean,
})
</script>

<template>
  <article class="metric-card panel" :class="[`accent-${accent}`, { 'is-signal': signal }]">
    <div class="metric-heading">
      <h2>{{ title }}</h2>
      <Info :size="16" aria-hidden="true" />
    </div>
    <p class="metric-value" :class="{ 'signal-value': signal }">{{ signal ? '待评估' : '—' }}</p>
    <p class="metric-description">{{ description }}</p>
    <div v-if="signal" class="signal-placeholder" aria-hidden="true">
      <span v-for="position in 5" :key="position" />
    </div>
    <div v-else class="sparkline-placeholder" aria-hidden="true">
      <ChartNoAxesCombined :size="20" :stroke-width="1.3" />
      <span>趋势图预留</span>
    </div>
    <p class="metric-period">{{ period }}</p>
  </article>
</template>

<style scoped>
.metric-card { --metric-accent: var(--color-blue); position: relative; overflow: hidden; min-height: 170px; padding: 14px 17px 12px; }
.accent-cyan { --metric-accent: var(--color-cyan); }
.accent-purple { --metric-accent: var(--color-purple); }
.metric-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.metric-heading h2 { font-size: 13px; font-weight: 500; color: #dfe5f1; }
.metric-heading svg { color: var(--color-text-muted); }
.metric-value { margin-top: 7px; font-family: var(--font-mono); font-size: 30px; font-weight: 600; line-height: 1.25; color: #d9e4f8; }
.metric-description { margin-top: 2px; font-size: 11px; color: var(--color-text-muted); }
.sparkline-placeholder { display: flex; align-items: center; justify-content: center; gap: 6px; height: 42px; margin: 5px -17px 0; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--metric-accent) 5%, transparent)); border-bottom: 1px solid color-mix(in srgb, var(--metric-accent) 18%, transparent); color: color-mix(in srgb, var(--metric-accent) 58%, #4c5870); font-size: 10px; }
.sparkline-placeholder svg { opacity: .65; }
.metric-period { margin-top: 6px; font-size: 11px; color: #7e8da6; }
.signal-value { color: #759acf; font-family: var(--font-sans); font-size: 25px; line-height: 1.5; letter-spacing: 2px; }
.signal-placeholder { display: flex; gap: 5px; padding: 20px 0 16px; }
.signal-placeholder span { flex: 1; height: 7px; border-radius: 5px; background: #1e2b42; }
.signal-placeholder span:nth-child(3) { background: #2b405f; }
</style>
