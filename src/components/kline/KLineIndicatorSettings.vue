<script setup>
import { computed, ref, watch } from 'vue'
import { RotateCcw, Settings2 } from 'lucide-vue-next'
import { getMainIndicatorDefinition } from '../../charts/kline/mainIndicators.js'
import { getSubIndicatorDefinition } from '../../charts/kline/subIndicators.js'

const props = defineProps({
  subIndicator: { type: String, required: true },
  settings: { type: Object, required: true },
  disabled: Boolean,
})
const emit = defineEmits(['apply'])
const menu = ref(null)
const trigger = ref(null)
const activeSection = ref('sub')
const draft = ref({})
const error = ref('')

const sections = computed(() => {
  const subDefinition = getSubIndicatorDefinition(props.subIndicator)
  const bollDefinition = getMainIndicatorDefinition('boll')
  return {
    sub: {
      key: props.subIndicator,
      label: subDefinition.label,
      definition: subDefinition,
    },
    boll: {
      key: 'boll',
      label: bollDefinition.label,
      definition: bollDefinition,
    },
  }
})
const current = computed(() => sections.value[activeSection.value])

function resetDraft() {
  draft.value = { ...(props.settings[current.value.key] ?? current.value.definition.parameters) }
  error.value = ''
}

watch([() => props.subIndicator, () => props.settings, activeSection], resetDraft, { deep: true, immediate: true })

function validate() {
  const definition = current.value.definition
  for (const field of definition.parameterFields) {
    const value = Number(draft.value[field.key])
    if (!Number.isFinite(value)) return `${field.label} 请输入有效数字`
    if (value < field.min || value > field.max) return `${field.label} 范围为 ${field.min}–${field.max}`
    if (field.step === 1 && !Number.isInteger(value)) return `${field.label} 必须是整数`
  }
  if (current.value.key === 'macd' && draft.value.fastPeriod >= draft.value.slowPeriod) return 'MACD 快线周期必须小于慢线周期'
  if (current.value.key === 'rsi' && !(draft.value.shortPeriod < draft.value.mediumPeriod && draft.value.mediumPeriod < draft.value.longPeriod)) return 'RSI 周期必须满足 N1 < N2 < N3'
  return ''
}

function apply() {
  const message = validate()
  if (message) {
    error.value = message
    return
  }
  emit('apply', current.value.key, { ...draft.value })
  error.value = ''
  if (menu.value) menu.value.open = false
  trigger.value?.focus()
}

function restoreDefaults() {
  draft.value = { ...current.value.definition.parameters }
  error.value = ''
}

function closeMenu() {
  if (!menu.value?.open) return
  menu.value.open = false
  trigger.value?.focus()
}

function handleToggle() {
  if (menu.value?.open) resetDraft()
}

function handleFocusOut(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) menu.value.open = false
}
</script>

<template>
  <details ref="menu" class="indicator-settings" @toggle="handleToggle" @focusout="handleFocusOut" @keydown.esc.stop.prevent="closeMenu">
    <summary ref="trigger" :aria-disabled="disabled" aria-label="指标参数设置" title="设置 BOLL 和当前副图指标参数">
      <Settings2 :size="12" /> 参数
    </summary>
    <div class="settings-menu" role="dialog" aria-label="指标参数设置">
      <div class="settings-tabs" role="tablist" aria-label="参数分类">
        <button type="button" :class="{ selected: activeSection === 'sub' }" role="tab" :aria-selected="activeSection === 'sub'" @click="activeSection = 'sub'">{{ sections.sub.label }}</button>
        <button type="button" :class="{ selected: activeSection === 'boll' }" role="tab" :aria-selected="activeSection === 'boll'" @click="activeSection = 'boll'">BOLL</button>
      </div>

      <div class="settings-fields">
        <label v-for="field in current.definition.parameterFields" :key="field.key">
          <span>{{ field.label }}</span>
          <input v-model.number="draft[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step" :disabled="disabled" @keydown.enter.prevent="apply" />
        </label>
      </div>

      <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
      <p v-else class="settings-help">修改后点击应用；周期切换时参数保持不变。</p>

      <div class="settings-actions">
        <button type="button" class="reset-button" :disabled="disabled" @click="restoreDefaults"><RotateCcw :size="11" />默认值</button>
        <button type="button" class="apply-button" :disabled="disabled" @click="apply">应用</button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.indicator-settings { position: relative; }
summary { display: flex; align-items: center; gap: 5px; padding: 4px 8px; border: 1px solid #373b48; border-radius: 3px; background: #1c1f28; color: #bfc3d1; cursor: pointer; list-style: none; white-space: nowrap; }
summary::-webkit-details-marker { display: none; }
summary:hover { color: #f4f5f8; background: #2b303c; }
summary[aria-disabled="true"] { opacity: .45; pointer-events: none; }
.settings-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 12; width: min(320px, calc(100vw - 32px)); padding: 11px; border: 1px solid #414552; border-radius: 6px; background: #1c1e26; box-shadow: 0 10px 28px #0009; }
.settings-tabs { display: flex; gap: 5px; margin-bottom: 10px; }
.settings-tabs button, .settings-actions button { border: 1px solid #373b48; border-radius: 4px; background: #232630; color: #aeb4c3; font-size: 10px; }
.settings-tabs button { padding: 4px 9px; }
.settings-tabs button.selected { border-color: #6382aa; background: #2c3d53; color: #e6f2ff; }
.settings-fields { display: grid; gap: 7px; }
.settings-fields label { display: grid; grid-template-columns: minmax(0, 1fr) 92px; align-items: center; gap: 10px; color: #aeb4c3; }
.settings-fields input { width: 100%; box-sizing: border-box; padding: 5px 7px; border: 1px solid #3a3e4b; border-radius: 4px; outline: none; background: #14161c; color: #e0e3eb; font-size: 11px; font-variant-numeric: tabular-nums; }
.settings-fields input:focus { border-color: #6382aa; }
.settings-help, .settings-error { min-height: 16px; margin: 8px 0 0; font-size: 9px; line-height: 1.5; }
.settings-help { color: #777e8d; }
.settings-error { color: #ff747b; }
.settings-actions { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
.settings-actions button { display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; }
.settings-actions button:disabled { opacity: .45; }
.settings-actions .apply-button { border-color: #5477a5; background: #2c3d53; color: #e8f2ff; }
@media (max-width: 620px) {
  .settings-menu { right: auto; left: 0; }
}
</style>
