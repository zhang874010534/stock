<script setup>
import { ref } from 'vue'
import { NConfigProvider, darkTheme, zhCN, dateZhCN } from 'naive-ui'
import AppHeader from './components/AppHeader.vue'
import AppSidebar from './components/AppSidebar.vue'
import Home from './views/Home.vue'

const instrument = ref('H30269')
const sidebarOpen = ref(false)
const themeOverrides = {
  common: {
    primaryColor: '#408cff',
    primaryColorHover: '#68a5ff',
    primaryColorPressed: '#2871e4',
    primaryColorSuppl: '#408cff',
    bodyColor: '#050b16',
    cardColor: '#0c1423',
    popoverColor: '#111d32',
    borderColor: '#223049',
    textColorBase: '#eff3fc',
    textColor1: '#eff3fc',
    textColor2: '#a0abc0',
    textColor3: '#63718b',
    borderRadius: '7px',
    fontFamily: "'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
}
</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <div class="app-shell" @keydown.esc="sidebarOpen = false">
      <a class="skip-link" href="#main-content">跳转到主要内容</a>
      <AppHeader v-model:instrument="instrument" :menu-open="sidebarOpen" @toggle-menu="sidebarOpen = !sidebarOpen" />
      <button v-if="sidebarOpen" class="sidebar-backdrop" aria-label="关闭导航" @click="sidebarOpen = false" />
      <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
      <main id="main-content" class="app-main" tabindex="-1">
        <Home :instrument="instrument" />
      </main>
    </div>
  </NConfigProvider>
</template>

<style scoped>
.app-shell { min-height: 100svh; }
.app-main {
  margin-left: var(--sidebar-width);
  padding: calc(var(--header-height) + 16px) 20px 20px;
  background: radial-gradient(ellipse at 90% 0%, #10204820, transparent 50%);
}
.skip-link {
  position: fixed;
  top: -60px;
  left: 20px;
  z-index: 100;
  padding: 10px 16px;
  background: var(--color-blue);
  border-radius: 6px;
}
.skip-link:focus { top: 10px; }
.sidebar-backdrop { display: none; }
@media (max-width: 900px) {
  .app-main { margin-left: 0; padding-inline: 16px; }
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: var(--header-height) 0 0;
    z-index: 35;
    background: #0008;
    border: none;
    backdrop-filter: blur(3px);
  }
}
@media (max-width: 540px) {
  .app-main { padding-inline: 12px; }
}
</style>
