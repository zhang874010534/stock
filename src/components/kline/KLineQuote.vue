<script setup>
import { formatIndexValue } from '../../utils/indexHistory.js'
import { formatVolume } from '../../utils/kline.js'

const props = defineProps({
  decimals: { type: Number, default: 2 },
  quote: { type: Object, default: null },
  movingAverages: { type: Array, required: true },
  mainIndicators: { type: Array, default: () => [] },
  activeIndex: { type: Number, required: true },
  isLatest: Boolean,
})

const formatPrice = value => formatIndexValue(value, props.decimals)

function signed(value, suffix = '') {
  if (!Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(suffix === '%' ? 2 : props.decimals)}${suffix}`
}
</script>

<template>
  <div class="kline-quote" aria-label="当前 K 线行情">
    <div class="quote-date"><time>{{ quote?.date ?? '—' }}</time><span>{{ isLatest ? '最新' : '历史' }}</span><span v-if="quote?.startDate && quote.startDate !== quote.endDate" class="period-span">{{ quote.startDate }} 起</span></div>
    <div class="quote-values">
      <span>开 <b>{{ formatPrice(quote?.open) }}</b></span>
      <span>高 <b>{{ formatPrice(quote?.high) }}</b></span>
      <span>低 <b>{{ formatPrice(quote?.low) }}</b></span>
      <span>收 <b :class="quote && quote.close >= quote.open ? 'up' : 'down'">{{ formatPrice(quote?.close) }}</b></span>
      <span title="相对上一根同周期 K 线收盘价；首根无前收盘价时显示 —">涨跌 <b :class="{ up: quote?.change > 0, down: quote?.change < 0 }">{{ signed(quote?.change) }}</b></span>
      <span>涨跌幅 <b :class="{ up: quote?.changePercent > 0, down: quote?.changePercent < 0 }">{{ signed(quote?.changePercent, '%') }}</b></span>
      <span>成交量 <b>{{ formatVolume(quote?.volume) }}</b></span>
    </div>
    <div class="ma-values" aria-label="当前主图指标数值">
      <span v-for="item in movingAverages.filter((ma) => ma.enabled)" :key="item.period" :style="{ color: item.color }" :title="`最近 ${item.period} 根当前周期 K 线的平均收盘价；不足 ${item.period} 根时显示 —`">MA{{ item.period }}: {{ formatPrice(item.data[activeIndex]) }}</span>
      <template v-for="indicator in mainIndicators" :key="indicator.key">
        <span v-for="line in indicator.lines" :key="line.id" :style="{ color: line.color }">{{ line.name }}: {{ formatPrice(line.data[activeIndex]) }}</span>
      </template>
      <span v-if="!movingAverages.some((item) => item.enabled) && !mainIndicators.length" class="ma-empty">主图指标已隐藏</span>
    </div>
  </div>
</template>

<style scoped>
.kline-quote { padding: 9px 0 5px; color: #9197a5; font-size: 11px; font-variant-numeric: tabular-nums; }
.quote-date, .quote-values, .ma-values { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 13px; }
.quote-date { margin-bottom: 6px; color: #d4d7e0; }
.quote-date > span { font-size: 10px; color: #858b9b; }
.quote-values b { color: #d6d9e3; font-weight: 400; }
.quote-values span { white-space: nowrap; }
.quote-values .up { color: #ff454f; }
.quote-values .down { color: #00bec7; }
.ma-values { min-height: 20px; margin-top: 4px; }
.ma-values span { white-space: nowrap; }
.ma-empty { color: #777d8b; }
</style>
