<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { serializeOverlay } from '../../utils/chartExport.js'

const props = defineProps({ trades: Array, layout: Object, revision: Number, pointToPixel: Function })
const emit = defineEmits(['select'])
const root = ref(null), width = ref(0)
let observer
const visible = computed(() => {
  void props.revision
  const bounds = { left: props.layout.left, right: width.value - props.layout.right, top: props.layout.priceTop, bottom: props.layout.priceTop + props.layout.priceHeight }
  return props.trades.flatMap(trade => {
    const point = props.pointToPixel(trade.point)
    if (!point || point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return []
    return [{ ...trade, x: point.x, y: Math.max(bounds.top + 24, Math.min(bounds.bottom - 24, point.y + (trade.type === 'buy' ? 12 : -12))) }]
  })
})
onMounted(() => {
  observer = new ResizeObserver(() => { width.value = root.value.clientWidth })
  observer.observe(root.value); width.value = root.value.clientWidth
})
onBeforeUnmount(() => observer?.disconnect())
defineExpose({ visibleTrades: () => visible.value, exportOverlay: () => serializeOverlay(root.value?.querySelector('svg')) })
</script>

<template>
  <div ref="root" class="trades-overlay" aria-label="K线真实交易标记">
    <svg class="trades-svg" width="100%" height="100%">
      <svg :x="layout.left" :y="layout.priceTop" :width="Math.max(0, width - layout.left - layout.right)" :height="layout.priceHeight" :viewBox="`${layout.left} ${layout.priceTop} ${Math.max(1, width - layout.left - layout.right)} ${layout.priceHeight}`" overflow="hidden">
        <g v-for="trade in visible" :key="trade.id" class="trade-marker" :class="trade.type" :transform="`translate(${trade.x}, ${trade.y})`" role="button" tabindex="0" :aria-label="`真实交易 ${trade.title}`" @pointerdown.stop @click.stop="emit('select', trade.entries[0].id)" @keydown.enter.prevent="emit('select', trade.entries[0].id)" @keydown.space.prevent="emit('select', trade.entries[0].id)">
          <title>{{ trade.title }}&#10;点击查看账本记录</title><path :d="trade.type === 'buy' ? 'M 0,-6 L 6,4 L -6,4 Z' : 'M 0,6 L 6,-4 L -6,-4 Z'" /><text :y="trade.type === 'buy' ? 18 : -12" text-anchor="middle">{{ trade.label }}</text>
        </g>
      </svg>
    </svg>
  </div>
</template>

<style scoped>
.trades-overlay { position: absolute; inset: 0; z-index: 7; pointer-events: none; }.trades-svg { position: absolute; inset: 0; pointer-events: none; }.trade-marker { pointer-events: auto; cursor: pointer; outline: none; }.trade-marker path { stroke: #101116; stroke-width: 1.5; }.buy path { fill: #ff7988; }.sell path { fill: #5ad5ac; }
.trade-marker text { stroke: #101116; stroke-width: 3px; paint-order: stroke; font-family: sans-serif; font-size: 11px; font-weight: 600; }.buy text { fill: #ff7988; }.sell text { fill: #5ad5ac; }.trade-marker:focus-visible path { stroke: #67d5df; stroke-width: 3; }
</style>
