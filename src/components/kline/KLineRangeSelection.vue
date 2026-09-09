<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getKlineRangeStats } from '../../utils/klineRange.js'
import { formatIndexValue } from '../../utils/indexHistory.js'
import { formatAmount, formatVolume } from '../../utils/kline.js'

const props = defineProps({
  history: { type: Array, required: true }, layout: { type: Object, required: true },
  visibleWindow: { type: Object, required: true }, indexAtPixel: { type: Function, required: true },
  enabled: Boolean, instrument: String, periodLabel: String,
})
const emit = defineEmits(['zoom'])
const root = ref(null), menu = ref(null), dialog = ref(null)
const selection = ref(null), mode = ref(''), anchor = ref({ x: 0, y: 0 })
let pointerId = null, previousFocus
const stats = computed(() => selection.value ? getKlineRangeStats(props.history, selection.value.first, selection.value.last) : null)
const box = computed(() => {
  const s = selection.value
  if (!s) return {}
  return { left: `${Math.min(s.x1, s.x2)}px`, width: `${Math.max(1, Math.abs(s.x2 - s.x1))}px`,
    top: `${mode.value === 'stats' ? props.layout.priceTop : Math.min(s.y1, s.y2)}px`,
    height: `${mode.value === 'stats' ? props.layout.priceHeight : Math.max(1, Math.abs(s.y2 - s.y1))}px` }
})
const panelPosition = computed(() => ({ left: `${anchor.value.x}px`, top: `${anchor.value.y}px` }))
const tone = value => value > 0 ? 'up' : value < 0 ? 'down' : ''
const price = value => formatIndexValue(value, props.instrument === '512890' ? 3 : 2)
const percent = value => Number.isFinite(value) ? `${value.toFixed(2)}%` : '—'
const fields = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    ['起始价', price(s.startPrice)], ['终止价', price(s.endPrice)],
    ['最高', price(s.high)], ['最低', price(s.low)],
    ['收盘均价', price(s.average)], ['涨跌值', price(s.change), tone(s.change)],
    ['涨跌幅', percent(s.changePercent), tone(s.change)], ['振幅', percent(s.amplitude)],
    ['成交量', formatVolume(s.volume)], ['成交额', formatAmount(s.amount)],
    ['累计换手', percent(s.turnover)], ['平线', s.flat], ['阳线', s.bullish, 'up'], ['阴线', s.bearish, 'down'],
  ]
})

function clear(restoreFocus = false) {
  if (pointerId !== null && root.value?.hasPointerCapture(pointerId)) root.value.releasePointerCapture(pointerId)
  pointerId = null
  selection.value = null
  mode.value = ''
  if (restoreFocus) previousFocus?.focus({ preventScroll: true })
}
function point(event) {
  const rect = root.value.getBoundingClientRect(), l = props.layout
  return { x: Math.max(l.left, Math.min(rect.width - l.right, event.clientX - rect.left)),
    y: Math.max(l.priceTop, Math.min(l.priceTop + l.priceHeight, event.clientY - rect.top)) }
}
function start(event) {
  if (event.button !== 2 || !props.enabled || event.target.closest('.range-menu, .range-dialog')) return
  const rect = root.value.getBoundingClientRect(), l = props.layout
  const x = event.clientX - rect.left, y = event.clientY - rect.top
  if (x < l.left || x > rect.width - l.right || y < l.priceTop || y > l.priceTop + l.priceHeight) return
  event.preventDefault()
  event.stopPropagation()
  clear()
  const p = point(event), first = props.indexAtPixel(p.x)
  if (first === null) return
  previousFocus = document.activeElement
  pointerId = event.pointerId
  root.value.setPointerCapture(pointerId)
  selection.value = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, first, last: first }
  mode.value = 'drag'
}
function move(event) {
  if (mode.value !== 'drag' || event.pointerId !== pointerId) return
  event.preventDefault()
  event.stopPropagation()
  const p = point(event)
  selection.value = { ...selection.value, x2: p.x, y2: p.y, last: props.indexAtPixel(p.x) }
}
async function finish(event) {
  if (mode.value !== 'drag' || event.pointerId !== pointerId) return
  move(event)
  const s = selection.value
  root.value.releasePointerCapture(pointerId)
  pointerId = null
  if (Math.abs(s.x2 - s.x1) < 5) { clear(); return }
  anchor.value = { x: Math.max(0, Math.min(s.x2, root.value.clientWidth - 156)), y: Math.max(0, Math.min(s.y2, root.value.clientHeight - 82)) }
  mode.value = 'menu'
  await nextTick()
  menu.value?.querySelector('button')?.focus({ preventScroll: true })
}
async function showStats() {
  const width = Math.min(430, root.value.clientWidth - 16)
  const right = Math.max(selection.value.x1, selection.value.x2) + 16
  anchor.value = { x: Math.max(8, Math.min(right, root.value.clientWidth - width - 8)), y: Math.max(8, Math.min(anchor.value.y, root.value.clientHeight - 410)) }
  mode.value = 'stats'
  await nextTick()
  dialog.value?.focus({ preventScroll: true })
}
function zoom() {
  const { startIndex, endIndex } = stats.value
  clear(true)
  emit('zoom', startIndex, endIndex)
}
function keydown(event) {
  if (!mode.value) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); clear(true)
  } else if (['menu', 'stats'].includes(mode.value) && (event.key === 'Tab' || (mode.value === 'menu' && ['ArrowDown', 'ArrowUp'].includes(event.key)))) {
    const controls = [...(mode.value === 'menu' ? menu.value : dialog.value).querySelectorAll('button')]
    const index = controls.indexOf(document.activeElement)
    const step = event.shiftKey || event.key === 'ArrowUp' ? -1 : 1
    event.preventDefault(); event.stopImmediatePropagation()
    controls[(index + step + controls.length) % controls.length]?.focus()
  }
}
function outside(event) {
  if (mode.value && mode.value !== 'drag' && !event.target.closest('.range-menu, .range-dialog')) clear()
}
function blockRightMouse(event) {
  if (event.button === 2) { event.preventDefault(); event.stopPropagation() }
}
watch([() => props.history, () => props.visibleWindow, () => props.layout, () => props.enabled], () => clear())
onMounted(() => {
  window.addEventListener('keydown', keydown, true)
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('blur', clearOnBlur)
})
function clearOnBlur() { clear() }
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown, true)
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('blur', clearOnBlur)
})
</script>

<template>
  <div ref="root" class="range-selection" @pointerdown.capture="start" @pointermove.capture="move" @pointerup.capture="finish" @pointercancel="clear()" @contextmenu.prevent @mousedown.capture="blockRightMouse">
    <slot />
    <div v-if="selection" class="range-box" :style="box" aria-hidden="true" />
    <div v-if="mode === 'menu'" ref="menu" class="range-menu" :style="panelPosition" role="menu" aria-label="所选区间操作" @pointerdown.stop @wheel.stop>
      <button role="menuitem" @click="showStats">区间统计</button>
      <button role="menuitem" @click="zoom">区间放大</button>
    </div>
    <section v-if="mode === 'stats' && stats" ref="dialog" class="range-dialog" :style="panelPosition" role="dialog" aria-modal="true" aria-label="K线区间统计" tabindex="-1" @pointerdown.stop @wheel.stop>
      <header><span>{{ instrument }} · {{ periodLabel }}区间统计</span><button aria-label="关闭区间统计" @click="clear(true)">×</button></header>
      <div class="range-dates"><div><p>起始时间 <time>{{ stats.startDate }}</time></p><p>终止时间 <time>{{ stats.endDate }}</time></p></div><span class="range-count">周期个数<strong>{{ stats.count }}</strong></span></div>
      <dl><div v-for="[label, value, color] in fields" :key="label"><dt>{{ label }}</dt><dd :class="color">{{ value }}</dd></div></dl>
      <p class="range-basis">起止价取首尾收盘价；涨跌、振幅以起始价为基准，均价为各根收盘价平均值。</p>
    </section>
  </div>
</template>

<style scoped>
.range-selection { position: relative; }
.range-box { position: absolute; z-index: 8; border: 1px dashed #c5d9e8; background: #278dcc40; pointer-events: none; }
.range-menu, .range-dialog { position: absolute; z-index: 20; border: 1px solid #339bd5; background: #10131b; color: #c1cbdc; box-shadow: 0 6px 24px #0005; font-size: 13px; }
.range-menu { width: 152px; padding: 3px; }
.range-menu button { display: block; width: 100%; text-align: left; padding: 8px 12px; border: 0; background: transparent; color: inherit; }
.range-menu button + button { border-top: 1px solid #2b3040; }
.range-menu button:hover, .range-menu button:focus-visible { background: #234159; outline: none; }
.range-dialog { width: min(430px, calc(100% - 16px)); max-height: calc(100% - 16px); overflow: auto; font-variant-numeric: tabular-nums; outline: none; }
header { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; background: #1a1d27; }
header button { background: transparent; border: 0; color: #b5bdc9; font-size: 22px; line-height: 1; }
.range-dates { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; }
.range-dates p { margin: 4px 0; }
time { display: inline-block; margin-left: 8px; padding: 2px 8px; border: 1px solid #222631; }
.range-count { padding: 8px 12px; text-align: center; background: #1a1d27; }
.range-count strong { display: block; padding-top: 3px; font-weight: 400; }
dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 22px; padding: 14px; margin: 0; }
dl > div { display: flex; justify-content: space-between; gap: 8px; }
dd { margin: 0; color: #c6d5e8; }
.up { color: #ff454f; }.down { color: #00be65; }
.range-basis { font-size: 11px; line-height: 1.6; color: #8895a8; border-top: 1px solid #252c38; margin: 0 14px; padding: 10px 0; }
@media(max-width: 500px) { dl { gap: 10px; font-size: 12px; padding: 10px; } .range-dates { padding: 10px; gap: 4px; font-size: 12px; } }
</style>
