<script setup>
import { ChevronDown, ChevronUp, EyeOff } from 'lucide-vue-next'
defineProps({ module: { type: Object, required: true } })
defineEmits(['collapse', 'hide'])
</script>
<template>
  <div v-show="!module.hidden" class="homepage-module" :class="{ collapsed: module.collapsed }" :data-home-module="module.id">
    <div class="module-controls" :class="{ panel: module.collapsed }">
      <button type="button" class="module-toggle" :aria-label="`${module.collapsed ? '展开' : '折叠'}${module.label}`" :aria-expanded="!module.collapsed" :aria-controls="`${module.id}-body`" @click="$emit('collapse')"><component :is="module.collapsed ? ChevronDown : ChevronUp" :size="14" /><span>{{ module.label }}</span><small v-if="module.collapsed">已折叠</small></button>
      <button type="button" class="module-hide" :aria-label="`隐藏${module.label}`" @click="$emit('hide')"><EyeOff :size="13" /><span>隐藏</span></button>
    </div>
    <div v-show="!module.collapsed" :id="`${module.id}-body`" class="module-body"><slot /></div>
  </div>
</template>
<style scoped>
.homepage-module, .module-body { min-width: 0; } .module-controls { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 3px 7px; }
.module-controls.panel { padding: 13px 16px; } button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: #8da5c6; font: inherit; font-size: 11px; cursor: pointer; padding: 3px; } button:hover { color: #c5ddff; } .collapsed .module-toggle { color: #c5ddff; font-size: 13px; } small { color: #8da5c6; font-size: 10px; margin-left: 5px; }
button:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; border-radius: 4px; }
</style>
