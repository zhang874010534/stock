<script setup>
import { House, Gauge, ChartColumn, Percent, ChartNoAxesCombined, Layers3, Compass, Globe2, ScanLine, Grid2X2, Ellipsis, MessageSquare, X } from 'lucide-vue-next'

defineProps({ open: Boolean })
defineEmits(['close'])

const navigation = [
  { label: '指数概览', icon: Gauge },
  { label: '估值分析', icon: ChartColumn },
  { label: '股息率', icon: Percent },
  { label: '历史分位', icon: ChartNoAxesCombined },
  { label: '成分股', icon: Layers3 },
  { label: '策略观察', icon: Compass },
]
const futureNavigation = [
  { label: '行业分析', icon: ChartColumn },
  { label: '宏观环境', icon: Globe2 },
  { label: '回测工具', icon: ScanLine },
  { label: '组合配置', icon: Grid2X2 },
  { label: '更多模块', icon: Ellipsis },
]
</script>

<template>
  <aside id="app-navigation" class="app-sidebar" :class="{ 'is-open': open }" aria-label="主导航">
    <button class="close-navigation" aria-label="关闭导航" @click="$emit('close')"><X :size="19" /></button>
    <nav class="navigation">
      <a class="nav-item is-active" href="#main-content" aria-current="page" @click="$emit('close')">
        <House :size="20" :stroke-width="1.7" /><span>首页</span>
      </a>
      <button v-for="item in navigation" :key="item.label" class="nav-item" disabled :title="`${item.label}将在后续阶段开放`">
        <component :is="item.icon" :size="19" :stroke-width="1.6" /><span>{{ item.label }}</span>
      </button>
      <div class="nav-divider" />
      <p class="nav-section-label">未来扩展（规划中）<span /></p>
      <button v-for="item in futureNavigation" :key="item.label" class="nav-item future-item" disabled title="功能规划中">
        <component :is="item.icon" :size="19" :stroke-width="1.6" /><span>{{ item.label }}</span>
      </button>
    </nav>
    <div class="sidebar-footer">
      <span class="mono">V0.1.0</span>
      <button disabled title="反馈入口将在后续开放"><MessageSquare :size="14" />反馈建议</button>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  position: fixed;
  top: var(--header-height);
  bottom: 0;
  left: 0;
  z-index: 40;
  width: var(--sidebar-width);
  display: flex;
  flex-direction: column;
  padding: 20px 14px 18px;
  border-right: 1px solid var(--color-border-soft);
  background: linear-gradient(175deg, #07101e, #060d19 60%, #091425);
}
.navigation { flex: 1; min-height: 0; overflow-y: auto; }
.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 41px;
  margin-bottom: 7px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  font-size: 14px;
  color: #a4afc3;
  white-space: nowrap;
}
.nav-item svg { flex-shrink: 0; }
.nav-item.is-active {
  border-color: #2b64c7;
  color: #f2f6ff;
  background: linear-gradient(100deg, #183767, #142852);
  box-shadow: inset 0 0 16px #3e7eff14;
  font-weight: 600;
}
.is-active svg { color: #83b8ff; filter: drop-shadow(0 0 5px #397fff); }
.nav-item:disabled { color: #919cb1; }
.nav-divider { margin: 22px 6px 20px; height: 1px; background: var(--color-border-soft); }
.nav-section-label { display: flex; align-items: center; justify-content: space-between; padding: 0 12px; margin-bottom: 12px; color: var(--color-text-muted); font-size: 12px; }
.nav-section-label span { width: 5px; height: 5px; background: #4f7df4; border-radius: 50%; }
.nav-item.future-item { color: #59677e; }
.sidebar-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 16px; padding: 8px 10px 8px 16px; border: 1px solid var(--color-border-soft); border-radius: 26px; font-size: 11px; color: #7b89a2; }
.sidebar-footer button { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 0; border-radius: 22px; background: #121e31; color: #7b89a2; font-size: 11px; }
.close-navigation { display: none; }
@media (max-width: 900px) {
  .app-sidebar { transform: translateX(-100%); visibility: hidden; transition: transform .2s ease, visibility .2s; }
  .app-sidebar.is-open { transform: translateX(0); visibility: visible; }
  .close-navigation { display: flex; align-self: flex-end; align-items: center; padding: 4px; margin: -8px 0 10px; background: none; border: 0; color: var(--color-text-secondary); }
}
</style>
