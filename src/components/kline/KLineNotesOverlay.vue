<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { serializeOverlay } from '../../utils/chartExport.js'

const props = defineProps({ notes: Array, layout: Object, revision: Number, pointToPixel: Function, pointAtPixel: Function, picking: Boolean })
const emit = defineEmits(['select', 'point', 'cancel'])
const root = ref(null), width = ref(0)
let observer
const visible = computed(() => {
  void props.revision
  const bounds = { left: props.layout.left, right: width.value - props.layout.right, top: props.layout.priceTop, bottom: props.layout.priceTop + props.layout.priceHeight }
  return props.notes.flatMap(note => {
    const point = note.point && props.pointToPixel(note.point)
    return point && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom ? [{ ...note, ...point }] : []
  })
})
function selectPoint(event) {
  if (event.button !== 0) return
  const bounds = root.value.getBoundingClientRect()
  const point = props.pointAtPixel(event.clientX - bounds.left, event.clientY - bounds.top)
  if (point && point.price > 0) emit('point', point)
}
onMounted(() => {
  observer = new ResizeObserver(() => { width.value = root.value.clientWidth })
  observer.observe(root.value); width.value = root.value.clientWidth
})
onBeforeUnmount(() => { observer?.disconnect() })
defineExpose({ visibleNotes: () => visible.value, exportOverlay: () => serializeOverlay(root.value?.querySelector('svg'), '.note-pick-surface') })
</script>

<template>
  <div ref="root" class="notes-overlay" aria-label="图表观察笔记">
    <svg class="notes-svg" width="100%" height="100%">
      <svg :x="layout.left" :y="layout.priceTop" :width="Math.max(0, width - layout.left - layout.right)" :height="layout.priceHeight" :viewBox="`${layout.left} ${layout.priceTop} ${Math.max(1, width - layout.left - layout.right)} ${layout.priceHeight}`" overflow="hidden">
        <g v-for="note in visible" :key="note.id" class="note-marker" :transform="`translate(${note.x}, ${note.y})`" role="button" tabindex="0" :aria-label="`${note.label} ${note.date}：${note.text}`" @pointerdown.stop @click.stop="emit('select', note.id)" @keydown.enter.prevent="emit('select', note.id)" @keydown.space.prevent="emit('select', note.id)">
          <title>{{ note.date }}{{ note.price === null ? '' : ` · ${note.price}` }}：{{ note.text }}</title>
          <circle r="5" /><text :y="note.y < layout.priceTop + 20 ? 18 : -10" x="0" text-anchor="middle">{{ note.label }}</text>
        </g>
        <rect v-if="picking" class="note-pick-surface" :x="layout.left" :y="layout.priceTop" :width="Math.max(0, width - layout.left - layout.right)" :height="layout.priceHeight" @pointerdown.stop.prevent="selectPoint" @contextmenu.stop.prevent="emit('cancel')" />
      </svg>
    </svg>
    <p v-if="picking" class="note-pick-hint" :style="{ left: `${layout.left + 8}px`, top: `${layout.priceTop + 8}px` }" role="status">点击日期／价格位置 · Esc 或右键取消</p>
  </div>
</template>

<style scoped>
.notes-overlay { position: absolute; inset: 0; z-index: 8; pointer-events: none; }
.notes-svg { position: absolute; inset: 0; pointer-events: none; }
.note-marker { pointer-events: auto; cursor: pointer; outline: none; }
.note-marker circle { fill: #ffd43b; stroke: #11151e; stroke-width: 1.5; }
.note-marker text { fill: #ffd43b; stroke: #101116; stroke-width: 3px; paint-order: stroke; font-family: sans-serif; font-size: 11px; font-weight: 600; }
.note-marker:focus-visible circle { stroke: #67d5df; stroke-width: 3; }
.note-pick-surface { fill: transparent; pointer-events: all; cursor: crosshair; touch-action: none; }
.note-pick-hint { position: absolute; color: #ffd43b; background: #172032ee; padding: 6px 8px; font-size: 11px; border-radius: 4px; }
</style>
