<script setup>
import { Info } from 'lucide-vue-next'
import { NPopover } from 'naive-ui'
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  period: { type: String, default: '' },
  accent: { type: String, default: 'blue' },
  value: { type: String, default: '—' },
  source: { type: String, default: '' },
  sourceUrl: { type: String, default: '' },
  detail: { type: String, default: '' },
})
</script>
<template>
  <article class="metric-card panel" :class="`accent-${accent}`">
    <div class="metric-heading">
      <h2>{{ title }}</h2>
      <NPopover v-if="source || detail" trigger="click" placement="bottom" :width="260">
        <template #trigger><button class="info-button" :aria-label="`${title}来源与口径说明`"><Info :size="15" /></button></template>
        <div class="metric-info"><p>{{ detail }}</p><a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener noreferrer">来源：{{ source }} ↗</a><p v-else-if="source">来源：{{ source }}</p></div>
      </NPopover>
    </div>
    <p class="metric-value">{{ value }}</p>
    <slot name="value-detail" />
    <p class="metric-description">{{ description }}</p>
    <p class="metric-period">{{ period }}</p>
    <slot />
  </article>
</template>
<style scoped>
.metric-card { --metric-accent: #d9e4f8; min-width: 0; padding: 16px 17px 14px; }
.accent-cyan { --metric-accent: #68d5de; }
.accent-purple { --metric-accent: #bfabef; }
.metric-heading { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
.metric-heading h2 { font-size: 12px; font-weight: 500; color: #c3d0e3; }
.info-button { display: flex; padding: 3px; margin: -3px; border: 0; background: none; color: #8b9db8; }
.metric-value { margin-top: 13px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: clamp(23px, 2.1vw, 32px); font-weight: 600; line-height: 1.25; color: var(--metric-accent); white-space: nowrap; }
.metric-description { margin-top: 5px; font-size: 11px; color: #8b9bb4; line-height: 1.5; }
.metric-period { margin-top: 14px; padding-top: 10px; border-top: 1px solid #1e2c42; font-size: 11px; color: #9aabc4; }
.metric-info { font-size: 12px; line-height: 1.7; }
.metric-info a { display: inline-block; margin-top: 7px; color: #9bc5ff; text-decoration: underline; }
@media (max-width: 640px) { .metric-card { padding: 14px 12px; } .metric-value { font-size: 24px; } .metric-heading h2 { font-size: 11px; } }
</style>
