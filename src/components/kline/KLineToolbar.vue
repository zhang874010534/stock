<script setup>
import { ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { KLINE_PERIODS } from '../../utils/kline.js'
import { INDEX_RANGES } from '../../utils/indexHistory.js'
import { SUB_INDICATOR_OPTIONS } from '../../charts/kline/subIndicators.js'
import KLineIndicatorSettings from './KLineIndicatorSettings.vue'

defineProps({
  period: { type: String, required: true },
  chartType: { type: String, default: 'candlestick' },
  range: { type: String, required: true },
  maOptions: { type: Array, required: true },
  bollEnabled: Boolean,
  subIndicator: { type: String, required: true },
  indicatorSettings: { type: Object, required: true },
  disabled: Boolean,
  waveAvailable: Boolean,
})
const emit = defineEmits(['period-change', 'chart-type-change', 'range-change', 'ma-change', 'boll-change', 'indicator-change', 'settings-change'])
const maMenu = ref(null)
const maTrigger = ref(null)

function closeMenu() {
  if (!maMenu.value?.open) return
  maMenu.value.open = false
  maTrigger.value?.focus()
}

function handleFocusOut(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) maMenu.value.open = false
}
</script>

<template>
  <div class="kline-toolbar">
    <div class="toolbar-main">
      <div class="period-buttons" role="group" aria-label="K 线周期">
        <button v-for="item in KLINE_PERIODS" :key="item.key" type="button" :class="{ selected: period === item.key }" :aria-pressed="period === item.key" :disabled="disabled" @click="emit('period-change', item.key)">{{ item.label }}</button>
      </div>
      <div class="period-buttons" role="group" aria-label="主图类型">
        <button type="button" :class="{ selected: chartType === 'candlestick' }" :aria-pressed="chartType === 'candlestick'" :disabled="disabled" @click="emit('chart-type-change', 'candlestick')">K线</button>
        <button type="button" :class="{ selected: chartType === 'line' }" :aria-pressed="chartType === 'line'" :disabled="disabled" title="按当前周期的收盘价绘制折线" @click="emit('chart-type-change', 'line')">折线</button>
      </div>
      <details ref="maMenu" class="ma-selector" @focusout="handleFocusOut" @keydown.esc.stop.prevent="closeMenu">
        <summary ref="maTrigger" aria-label="MA 均线设置">MA <ChevronDown :size="12" /></summary>
        <div class="ma-menu" role="group" aria-label="显示均线">
          <span class="menu-caption">显示均线</span>
          <label v-for="item in maOptions" :key="item.period" :style="{ color: item.color }">
            <input type="checkbox" :checked="item.enabled" :disabled="disabled" @change="emit('ma-change', item.period, $event.target.checked)" />
            <span>MA{{ item.period }}</span><i :style="{ background: item.color }" />
          </label>
        </div>
      </details>
      <button type="button" class="boll-button" :class="{ selected: bollEnabled }" :aria-pressed="bollEnabled" :disabled="disabled" title="在主图显示/隐藏 BOLL" @click="emit('boll-change', !bollEnabled)">BOLL</button>
      <label class="indicator-selector">副图
        <select :value="subIndicator" :disabled="disabled" aria-label="副图指标" @change="emit('indicator-change', $event.target.value)">
          <option v-for="item in SUB_INDICATOR_OPTIONS" :key="item.key" :value="item.key" :disabled="item.key === 'wave' && !waveAvailable">{{ item.label }}{{ item.key === 'wave' && !waveAvailable ? '（指标不可用）' : '' }}</option>
        </select>
      </label>
      <KLineIndicatorSettings :sub-indicator="subIndicator" :settings="indicatorSettings" :disabled="disabled" @apply="(key, value) => emit('settings-change', key, value)" />
    </div>
    <div class="range-buttons" role="group" aria-label="指数 K 线时间范围">
      <button type="button" :class="{ selected: range === 'recent' }" :aria-pressed="range === 'recent'" :disabled="disabled" @click="emit('range-change', 'recent')">最近</button>
      <button v-for="item in INDEX_RANGES" :key="item.key" type="button" :class="{ selected: range === item.key }" :aria-pressed="range === item.key" :disabled="disabled" @click="emit('range-change', item.key)">{{ item.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.kline-toolbar { display: flex; justify-content: space-between; flex-wrap: wrap; align-items: center; gap: 8px 18px; padding: 9px 0; border-bottom: 1px solid #292c35; font-size: 11px; }
.toolbar-main, .period-buttons, .range-buttons { display: flex; align-items: center; gap: 4px; }
.toolbar-main { flex-wrap: wrap; gap: 8px; }
button, summary, select { border: 1px solid #373b48; border-radius: 3px; color: #bfc3d1; background: #1c1f28; }
button { padding: 3px 8px; line-height: 1.5; white-space: nowrap; }
button:hover, summary:hover { color: #f4f5f8; background: #2b303c; }
button.selected { color: #e4f2ff; border-color: #6382aa; background: #2c3d53; }
button:disabled { opacity: .45; }
.range-buttons { flex-wrap: wrap; gap: 3px; }
.range-buttons button { padding: 2px 5px; font-size: 10px; border-color: transparent; background: transparent; color: #8e94a4; }
.range-buttons button.selected { color: #e0e5ef; background: #2b303c; }
.ma-selector { position: relative; }
summary { display: flex; align-items: center; gap: 5px; padding: 4px 8px; cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
.ma-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 10; width: 154px; padding: 10px; border: 1px solid #414552; border-radius: 5px; background: #1c1e26; box-shadow: 0 8px 24px #0008; }
.menu-caption { display: block; margin-bottom: 6px; color: #989daa; }
.ma-menu label { display: flex; align-items: center; gap: 7px; padding: 6px 2px; cursor: pointer; }
.ma-menu input { margin: 0; accent-color: #819abc; }
.ma-menu i { width: 18px; height: 2px; margin-left: auto; }
.indicator-selector { display: flex; align-items: center; gap: 6px; color: #9197a7; }
select { padding: 3px 5px; font-size: 11px; }
.boll-button { padding: 3px 7px; font-size: 11px; }
</style>
