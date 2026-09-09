<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Eye, EyeOff, Minus, MousePointer2, Trash2, Undo2 } from 'lucide-vue-next'
import { clipParallelLine, validParallelDrawing } from '../../utils/parallelLines.js'
import { clipHorizontalLine, validHorizontalDrawing } from '../../utils/horizontalLines.js'

const props = defineProps({
  instrument: String, period: String, layout: Object, revision: Number,
  pointAtPixel: Function, pointToPixel: Function, priceToPixel: Function,
})
const root = ref(null), width = ref(0), drawing = ref(false), hidden = ref(false)
const tool = ref('parallel')
const points = ref([]), cursor = ref(null), drawings = ref([]), selected = ref(null), storageError = ref('')
let observer
const storageKey = computed(() => `stock:parallel-lines:v1:${props.instrument}:${props.period}`)
const rect = computed(() => ({ left: props.layout.left, right: width.value - props.layout.right,
  top: props.layout.priceTop, bottom: props.layout.priceTop + props.layout.priceHeight }))
const hint = computed(() => tool.value === 'horizontal' ? '点击确定水平线价格' : ['点击起点', '点击第二点确定方向', '点击第三点确定平行线间距'][points.value.length])
function cancel() { drawing.value = false; points.value = []; cursor.value = null }
function begin(type) { cancel(); tool.value = type; hidden.value = false; selected.value = null; drawing.value = true; root.value.focus({ preventScroll: true }) }
function save() {
  try { localStorage.setItem(storageKey.value, JSON.stringify(drawings.value)); storageError.value = '' }
  catch { storageError.value = '本机保存失败，刷新后画线会丢失' }
}
function load() {
  cancel(); selected.value = null; drawings.value = []; storageError.value = ''
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey.value) ?? '[]')
    if (Array.isArray(saved)) drawings.value = saved.filter(item => validHorizontalDrawing(item) || ((!item?.type || item.type === 'parallel') && validParallelDrawing(item)))
  } catch { storageError.value = '无法读取本机画线' }
}
function position(event) {
  const bounds = root.value.getBoundingClientRect()
  const x = event.clientX - bounds.left, y = event.clientY - bounds.top, r = rect.value
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
  return props.pointAtPixel(x, y)
}
function move(event) { if (drawing.value) cursor.value = position(event) }
function place(event) {
  if (!drawing.value || event.button !== 0) return
  const point = position(event)
  if (!point) return
  if (tool.value === 'horizontal') {
    const item = { id: crypto.randomUUID(), type: 'horizontal', price: point.price }
    drawings.value = [...drawings.value, item]; selected.value = item.id; save(); cancel()
    return
  }
  if (points.value.length === 1) {
    const a = props.pointToPixel(points.value[0]), b = props.pointToPixel(point)
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 3) return
  }
  points.value = [...points.value, point]; cursor.value = point
  if (points.value.length === 3) {
    const item = { id: crypto.randomUUID(), points: points.value }
    drawings.value = [...drawings.value, item]; selected.value = item.id; save(); cancel()
  }
}
function remove() {
  if (!selected.value) return
  drawings.value = drawings.value.filter(item => item.id !== selected.value); selected.value = null; save()
}
function choose(id) { selected.value = id; root.value.focus({ preventScroll: true }) }
function keydown(event) {
  if (event.target.closest?.('input, select, textarea, dialog, [contenteditable="true"]')) return
  if (event.key === 'Escape' && (drawing.value || (root.value?.contains(event.target) && selected.value))) {
    event.preventDefault(); event.stopImmediatePropagation(); cancel(); selected.value = null
  } else if (['Delete', 'Backspace'].includes(event.key) && root.value?.contains(event.target) && selected.value) {
    event.preventDefault(); event.stopImmediatePropagation(); remove()
  }
}
const rendered = computed(() => {
  void props.revision
  if (hidden.value || width.value <= props.layout.left + props.layout.right) return []
  const items = [...drawings.value]
  if (drawing.value && tool.value === 'horizontal' && cursor.value) items.push({ id: 'preview', type: 'horizontal', price: cursor.value.price })
  if (points.value.length) items.push({ id: 'preview', points: [...points.value, ...(cursor.value ? [cursor.value] : [])] })
  return items.map(item => {
    if (item.type === 'horizontal') {
      const line = clipHorizontalLine(props.priceToPixel(item.price), rect.value)
      return { id: item.id, anchors: [], lines: line ? [line] : [] }
    }
    const anchors = item.points.map(props.pointToPixel)
    const [a, b, c] = anchors
    return { id: item.id, anchors: anchors.filter(Boolean), lines: [
      clipParallelLine(a, b, a, rect.value), clipParallelLine(a, b, c, rect.value),
    ].filter(Boolean) }
  })
})
watch(storageKey, load)
onMounted(() => {
  load(); observer = new ResizeObserver(() => { width.value = root.value.clientWidth })
  observer.observe(root.value); width.value = root.value.clientWidth
  window.addEventListener('keydown', keydown, true)
})
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('keydown', keydown, true) })
</script>

<template>
  <div ref="root" class="drawing-overlay" tabindex="-1" aria-label="画线工具">
    <svg class="drawing-svg" width="100%" height="100%" aria-label="画线画布">
      <svg :x="layout.left" :y="layout.priceTop" :width="Math.max(0, width - layout.left - layout.right)" :height="layout.priceHeight" :viewBox="`${layout.left} ${layout.priceTop} ${Math.max(1, width - layout.left - layout.right)} ${layout.priceHeight}`" overflow="hidden">
        <g v-for="item in rendered" :key="item.id" :class="{ selected: selected === item.id }">
          <line v-for="(line, index) in item.lines" :key="`visible-${index}`" v-bind="line" class="drawn-line" :stroke-dasharray="item.id === 'preview' ? '5 4' : undefined" />
          <line v-for="(line, index) in item.lines" :key="`hit-${index}`" v-bind="line" class="hit-line" :style="{ pointerEvents: drawing ? 'none' : 'stroke' }" @pointerdown.stop.prevent="choose(item.id)" />
          <template v-if="selected === item.id || item.id === 'preview'">
            <circle v-for="(point, index) in item.anchors" :key="index" :cx="point.x" :cy="point.y" r="3.5" class="anchor" />
          </template>
        </g>
        <rect v-if="drawing" :x="layout.left" :y="layout.priceTop" :width="Math.max(0, width - layout.left - layout.right)" :height="layout.priceHeight" class="draw-surface" @pointermove.stop="move" @pointerdown.stop.prevent="place" @contextmenu.stop.prevent="cancel" @wheel.stop.prevent />
      </svg>
    </svg>
    <div class="drawing-tools" role="toolbar" aria-label="画线工具栏" @pointerdown.stop>
      <span class="tools-title">画线</span>
      <button title="退出画线" aria-label="退出画线" :class="{ active: !drawing }" @click="cancel"><MousePointer2 :size="17" /></button>
      <button title="平行线：依次点击三个点" aria-label="绘制平行线" :aria-pressed="drawing && tool === 'parallel'" :class="{ active: drawing && tool === 'parallel' }" @click="begin('parallel')"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12 14 3M6 17 17 8" /><rect x="2" y="11" width="3" height="3" fill="#151821" /><rect x="13" y="2" width="3" height="3" fill="#151821" /></svg></button>
      <button title="水平线：点击确定价格" aria-label="绘制水平线" :aria-pressed="drawing && tool === 'horizontal'" :class="{ active: drawing && tool === 'horizontal' }" @click="begin('horizontal')"><Minus :size="20" /></button>
      <button title="显示／隐藏画线" aria-label="隐藏画线" :aria-pressed="hidden" @click="hidden = !hidden; cancel()"><EyeOff v-if="hidden" :size="17" /><Eye v-else :size="17" /></button>
      <button title="取消本次画线（Esc）" aria-label="取消本次画线" :disabled="!drawing" @click="cancel"><Undo2 :size="17" /></button>
      <button title="删除选中画线（Delete）" aria-label="删除选中画线" :disabled="!selected" @click="remove"><Trash2 :size="17" /></button>
    </div>
    <p v-if="drawing" class="drawing-hint" :style="{ left: `${layout.left + 8}px`, top: `${layout.priceTop + 8}px` }" role="status">{{ tool === 'horizontal' ? '水平线' : '平行线' }} · {{ hint }} <span>右键 / Esc 取消</span></p>
    <p v-if="storageError" class="storage-error" role="status">{{ storageError }}</p>
  </div>
</template>

<style scoped>
.drawing-overlay { position: absolute; inset: 0; z-index: 7; pointer-events: none; outline: none; }
.drawing-svg { position: absolute; inset: 0; pointer-events: none; }
.drawn-line { stroke: #54bfff; stroke-width: 1.5; }
.selected .drawn-line { stroke: #ffd43b; stroke-width: 2; }
.hit-line { stroke: transparent; stroke-width: 12; cursor: pointer; }
.anchor { fill: #101116; stroke: #ffd43b; stroke-width: 1.5; }
.draw-surface { fill: transparent; pointer-events: all; cursor: crosshair; touch-action: none; }
.drawing-tools { position: absolute; top: 8px; right: 2px; display: flex; flex-direction: column; align-items: center; gap: 3px; width: 32px; padding: 5px 0; border: 1px solid #343d4f; border-radius: 4px; background: #151821; pointer-events: auto; }
.tools-title { color: #939eb1; font-size: 10px; padding-bottom: 4px; }
button { display: grid; place-items: center; width: 28px; height: 30px; border: 0; border-radius: 3px; color: #a7b3c6; background: transparent; cursor: pointer; }
button:hover, button.active { color: #54bfff; background: #223f50; }
button:disabled { opacity: .3; cursor: default; }
button:focus-visible { outline: 1px solid #54bfff; }
.drawing-hint { position: absolute; margin: 0; padding: 6px 9px; border: 1px solid #35546b; background: #152330ed; color: #c5e7ff; font-size: 12px; }
.drawing-hint span { margin-left: 12px; color: #91a1b6; font-size: 11px; }
.storage-error { position: absolute; bottom: 24px; left: 65px; color: #ffb86b; font-size: 11px; }
</style>
