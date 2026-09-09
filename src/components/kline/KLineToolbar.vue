<script setup>
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
  bbiEnabled: Boolean,
  subIndicator: { type: String, required: true },
  indicatorSettings: { type: Object, required: true },
  disabled: Boolean,
  waveAvailable: Boolean,
})
const emit = defineEmits(['period-change', 'chart-type-change', 'range-change', 'main-settings-change', 'indicator-change', 'settings-change'])
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
      <label class="indicator-selector">副图
        <select :value="subIndicator" :disabled="disabled" aria-label="副图指标" @change="emit('indicator-change', $event.target.value)">
          <option v-for="item in SUB_INDICATOR_OPTIONS" :key="item.key" :value="item.key" :disabled="item.key === 'wave' && !waveAvailable">{{ item.label }}{{ item.key === 'wave' && !waveAvailable ? '（指标不可用）' : '' }}</option>
        </select>
      </label>
      <KLineIndicatorSettings :sub-indicator="subIndicator" :settings="indicatorSettings" :ma-options="maOptions" :boll-enabled="bollEnabled" :bbi-enabled="bbiEnabled" :period-label="KLINE_PERIODS.find(item => item.key === period)?.label" :disabled="disabled" @apply="(key, value) => emit('settings-change', key, value)" @main-apply="emit('main-settings-change', $event)" />
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
.indicator-selector { display: flex; align-items: center; gap: 6px; color: #9197a7; }
select { padding: 3px 5px; font-size: 11px; }
</style>
