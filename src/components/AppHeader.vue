<script setup>
import { Activity, Menu } from 'lucide-vue-next'
import { NButton, NSelect } from 'naive-ui'

defineProps({ menuOpen: Boolean, instrument: { type: String, default: 'H30269' } })
defineEmits(['toggle-menu', 'update:instrument'])
const indexOptions = [{ label: 'H30269 · 指数', value: 'H30269' }, { label: '512890 · ETF', value: '512890' }]
</script>

<template>
  <header class="app-header">
    <div class="brand-group">
      <NButton class="menu-toggle" quaternary circle aria-label="切换导航" aria-controls="app-navigation" :aria-expanded="menuOpen" @click="$emit('toggle-menu')">
        <template #icon><Menu :size="21" /></template>
      </NButton>
      <a class="brand" href="#main-content" aria-label="红利低波数据看板首页">
        <span class="brand-icon"><Activity :size="30" :stroke-width="2.3" /></span>
        <span>红利低波<span class="brand-suffix">数据看板</span></span>
      </a>
    </div>
    <div class="index-picker">
      <span class="picker-label">证券选择</span>
      <NSelect class="index-select" :value="instrument" @update:value="$emit('update:instrument', $event)" :options="indexOptions" aria-label="选择证券" />
      <span class="index-limit">指数 / ETF</span>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: fixed;
  inset: 0 0 auto;
  z-index: 50;
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 22px;
  border-bottom: 1px solid var(--color-border-soft);
  background: #050b16f5;
  backdrop-filter: blur(16px);
}
.brand-group, .brand, .index-picker { display: flex; align-items: center; }
.brand-group { gap: 8px; }
.brand { gap: 13px; font-size: 20px; font-weight: 650; letter-spacing: .5px; white-space: nowrap; }
.brand-icon { display: flex; color: #6685ff; filter: drop-shadow(0 0 9px #4867f438); }
.index-picker { gap: 12px; font-size: 13px; }
.index-select { width: 154px; }
.picker-label { color: #c5cedd; white-space: nowrap; }
.index-limit { padding: 6px 9px; border: 1px solid var(--color-border-soft); border-radius: 6px; color: var(--color-text-secondary); font-size: 12px; }
.menu-toggle { display: none; }
@media (max-width: 900px) { .menu-toggle { display: inline-flex; } .app-header { padding-inline: 14px; } }
@media (max-width: 640px) {
  .brand { gap: 8px; font-size: 17px; }
  .brand-icon { display: none; }
  .index-limit, .picker-label { display: none; }
  .index-select { width: 114px; }
}
@media (max-width: 400px) { .brand-suffix { display: none; } }
</style>
