<script setup>
import { House, ChartNoAxesCombined, Database, LayoutGrid, ChevronDown, X } from 'lucide-vue-next'
defineProps({ open: Boolean })
defineEmits(['close'])
const navigation = [
  { label: '关键指标', icon: LayoutGrid, href: '#key-metrics' },
  { label: '收益与风险', icon: ChartNoAxesCombined, href: '#performance-metrics' },
  { label: '行情走势', icon: ChartNoAxesCombined, href: '#market-chart' },
  { label: '估值分析', icon: ChartNoAxesCombined, href: '#valuation-analysis' },
  { label: '数据说明', icon: Database, href: '#data-notes' },
]
const planned = ['行业分析', '宏观环境', '回测工具', '组合配置']
</script>
<template>
  <aside id="app-navigation" class="app-sidebar" :class="{ 'is-open': open }" aria-label="主导航">
    <button class="close-navigation" aria-label="关闭导航" @click="$emit('close')"><X :size="19" /></button>
    <nav class="navigation">
      <a class="nav-item is-active" href="#main-content" aria-current="page" @click="$emit('close')"><House :size="20" /><span>首页</span></a>
      <p class="nav-label">本页导航</p>
      <a v-for="item in navigation" :key="item.label" class="nav-item" :href="item.href" @click="$emit('close')"><component :is="item.icon" :size="19" :stroke-width="1.6" /><span>{{ item.label }}</span></a>
      <details class="planned-navigation"><summary>功能规划 <ChevronDown :size="14" /></summary><p v-for="label in planned" :key="label">{{ label }}<span>规划中</span></p></details>
    </nav>
    <div class="sidebar-footer"><span class="mono">V0.1.0</span><span>红利低波 · 长期观察</span></div>
  </aside>
</template>
<style scoped>
.app-sidebar { position: fixed; top: var(--header-height); bottom: 0; left: 0; z-index: 40; width: var(--sidebar-width); display: flex; flex-direction: column; padding: 20px 14px 18px; border-right: 1px solid var(--color-border-soft); background: linear-gradient(175deg, #07101e, #060d19 60%, #091425); }
.navigation { flex: 1; min-height: 0; overflow-y: auto; }
.nav-item { width: 100%; display: flex; align-items: center; gap: 14px; min-height: 43px; margin-bottom: 7px; padding: 8px 16px; border: 1px solid transparent; border-radius: 8px; font-size: 13px; color: #a4afc3; white-space: nowrap; }
.nav-item:hover { background: #12213a; color: #e1eaff; }
.nav-item.is-active { border-color: #2b64c7; color: #f2f6ff; background: linear-gradient(100deg, #183767, #142852); font-weight: 600; }
.is-active svg { color: #83b8ff; }
.nav-label { padding: 18px 16px 12px; color: #7f90ac; font-size: 11px; }
.planned-navigation { margin: 22px 6px 0; border-top: 1px solid var(--color-border-soft); padding-top: 18px; color: #8293ad; font-size: 12px; }
.planned-navigation summary { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; list-style: none; cursor: pointer; }
.planned-navigation summary::-webkit-details-marker { display: none; }
.planned-navigation[open] summary svg { transform: rotate(180deg); }
.planned-navigation p { display: flex; justify-content: space-between; padding: 10px; }
.planned-navigation p span { font-size: 10px; color: #72819a; }
.sidebar-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 18px 8px 0; margin-top: 16px; border-top: 1px solid var(--color-border-soft); font-size: 10px; color: #7b89a2; }
.close-navigation { display: none; }
@media (max-width: 900px) {
  .app-sidebar { transform: translateX(-100%); visibility: hidden; transition: transform .2s ease, visibility .2s; }
  .app-sidebar.is-open { transform: translateX(0); visibility: visible; }
  .close-navigation { display: flex; align-self: flex-end; align-items: center; padding: 4px; margin: -8px 0 10px; background: none; border: 0; color: var(--color-text-secondary); }
}
</style>
