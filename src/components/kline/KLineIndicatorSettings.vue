<script setup>
import { computed, ref } from 'vue'
import { RotateCcw, Settings2, X } from 'lucide-vue-next'
import { MA_OPTIONS } from '../../charts/kline/config.js'
import { getMainIndicatorDefinition } from '../../charts/kline/mainIndicators.js'
import { getSubIndicatorDefinition } from '../../charts/kline/subIndicators.js'

const props = defineProps({ subIndicator: { type: String, required: true }, settings: { type: Object, required: true }, maOptions: { type: Array, required: true }, bollEnabled: Boolean, bbiEnabled: Boolean, periodLabel: String, disabled: Boolean })
const emit = defineEmits(['apply', 'main-apply'])
const dialog = ref(null), trigger = ref(null), active = ref('ma'), draft = ref(null), error = ref('')
const sections = computed(() => [
  { key: 'ma', label: '均线 MA', description: '收盘价的简单移动平均线。分别设置每条均线的周期、显示状态、线宽和颜色；不足完整周期时不绘制。' },
  { key: 'boll', label: 'BOLL', definition: getMainIndicatorDefinition('boll'), description: '布林线：中轨为收盘价均线，上下轨为中轨加减指定倍数的总体标准差。' },
  { key: 'bbi', label: '牛熊线 BBI', definition: getMainIndicatorDefinition('bbi'), description: '四个周期的收盘价均线取等权平均，默认周期为 3、6、12、24。日线连续两天收盘低于 BBI 时，在第 2 天上方标注橙色 ▼ BBI下2，持续低于不重复标记。' },
  { key: props.subIndicator, label: `${getSubIndicatorDefinition(props.subIndicator).label} · 副图`, definition: getSubIndicatorDefinition(props.subIndicator), description: '设置当前副图指标的计算参数。' },
])
const current = computed(() => sections.value.find(section => section.key === active.value) ?? sections.value[0])
const maEnabled = computed(() => draft.value?.ma.some(line => line.enabled))
function open() {
  if (props.disabled) return
  draft.value = { ma: props.maOptions.map(line => ({ ...line, width: line.width ?? 1.2 })), enabled: { boll: props.bollEnabled, bbi: props.bbiEnabled }, settings: Object.fromEntries(sections.value.filter(s => s.definition).map(s => [s.key, { ...s.definition.parameters, ...props.settings[s.key] }])) }
  active.value = 'ma'; error.value = ''; dialog.value.showModal()
}
function close() { dialog.value.close(); trigger.value?.focus() }
function toggleMA(enabled) { draft.value.ma.forEach(line => { line.enabled = enabled }) }
function restoreDefaults() {
  if (active.value === 'ma') draft.value.ma = MA_OPTIONS.map(line => ({ ...line, width: 1.2 }))
  else draft.value.settings[current.value.key] = { ...current.value.definition.parameters }
  error.value = ''
}
function fail(key, message) { active.value = key; error.value = message; return false }
function validate() {
  const ma = draft.value.ma
  if (ma.some(line => !Number.isInteger(line.period) || line.period < 1 || line.period > 250)) return fail('ma', '均线周期必须为 1–250 的整数')
  if (new Set(ma.map(line => line.period)).size !== ma.length) return fail('ma', '各条均线的周期不能重复')
  if (ma.some(line => !Number.isFinite(line.width) || line.width < .5 || line.width > 5)) return fail('ma', '线宽范围为 0.5–5')
  for (const section of sections.value.filter(s => s.definition)) {
    const settings = draft.value.settings[section.key]
    for (const field of section.definition.parameterFields) {
      const value = settings[field.key]
      if (!Number.isFinite(value) || value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value))) return fail(section.key, `${field.label} 必须为 ${field.min}–${field.max} 范围内的${field.step === 1 ? '整数' : '数字'}`)
    }
    if (section.key === 'macd' && settings.fastPeriod >= settings.slowPeriod) return fail(section.key, 'MACD 快线周期必须小于慢线周期')
    if (section.key === 'rsi' && !(settings.shortPeriod < settings.mediumPeriod && settings.mediumPeriod < settings.longPeriod)) return fail(section.key, 'RSI 周期必须满足 N1 < N2 < N3')
  }
  return true
}
function apply() {
  if (!validate()) return
  emit('main-apply', { maOptions: draft.value.ma.map(line => ({ ...line })), bollEnabled: draft.value.enabled.boll, bbiEnabled: draft.value.enabled.bbi })
  for (const [key, settings] of Object.entries(draft.value.settings)) emit('apply', key, { ...settings })
  close()
}
</script>

<template>
  <div class="indicator-settings">
    <button ref="trigger" type="button" class="settings-trigger" :disabled="disabled" @click="open"><Settings2 :size="13" />指标设置</button>
    <dialog ref="dialog" class="settings-dialog" aria-label="指标设置" @cancel.prevent="close">
      <header><h2>指标设置 <span>（{{ periodLabel }}）</span></h2><button type="button" aria-label="关闭指标设置" @click="close"><X :size="18" /></button></header>
      <div v-if="draft" class="settings-content">
        <nav aria-label="指标分类">
          <div v-for="section in sections" :key="section.key" class="indicator-item" :class="{ selected: active === section.key }">
            <input v-if="section.key === 'ma'" type="checkbox" :checked="maEnabled" aria-label="显示均线 MA" @change="toggleMA($event.target.checked)" />
            <input v-else-if="section.key === 'boll' || section.key === 'bbi'" v-model="draft.enabled[section.key]" type="checkbox" :aria-label="`显示 ${section.key.toUpperCase()}`" />
            <button type="button" :aria-pressed="active === section.key" @click="active = section.key; error = ''">{{ section.label }}</button>
          </div>
        </nav>
        <div class="settings-editor">
          <h3>{{ current.label }}</h3><p class="description">{{ current.description }}</p>
          <table v-if="active === 'ma'" class="ma-table">
            <thead><tr><th>指标线</th><th>周期</th><th>线宽</th><th>颜色</th></tr></thead>
            <tbody><tr v-for="(line, index) in draft.ma" :key="index">
              <td><label><input v-model="line.enabled" type="checkbox" :aria-label="`显示 MA${index + 1}`" />MA{{ index + 1 }}</label></td>
              <td><input v-model.number="line.period" type="number" min="1" max="250" step="1" :aria-label="`MA${index + 1} 周期`" /></td>
              <td><input v-model.number="line.width" type="number" min="0.5" max="5" step="0.1" :aria-label="`MA${index + 1} 线宽`" /></td>
              <td><input v-model="line.color" type="color" :aria-label="`MA${index + 1} 颜色`" /></td>
            </tr></tbody>
          </table>
          <div v-else class="settings-fields"><label v-for="field in current.definition.parameterFields" :key="field.key"><span>{{ field.label }}</span><input v-model.number="draft.settings[current.key][field.key]" type="number" :min="field.min" :max="field.max" :step="field.step" /></label></div>
          <label v-if="active === 'bbi'" class="signal-toggle"><input v-model="draft.settings.bbi.showBelowTwo" type="checkbox" />显示 ▼ BBI下2 标记（仅日线）</label>
          <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
          <p class="settings-help">点击应用后生效；设置沿用于日、周、月、季线。</p>
        </div>
      </div>
      <footer><button type="button" @click="restoreDefaults"><RotateCcw :size="12" />恢复当前指标默认值</button><div><button type="button" @click="close">取消</button><button type="button" class="apply-button" @click="apply">应用</button></div></footer>
    </dialog>
  </div>
</template>

<style scoped>
button { cursor: pointer; border: 1px solid #373e4c; border-radius: 3px; background: #222735; color: #c8d0df; padding: 5px 10px; }
button:hover { background: #2e4054; color: #fff; } button:disabled { opacity: .45; cursor: default; }
.settings-trigger { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 4px 8px; white-space: nowrap; }
.settings-dialog { width: min(700px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); padding: 0; margin: auto; overflow: auto; border: 1px solid #3f819e; border-radius: 4px; background: #151821; color: #bcc9db; font-size: 13px; box-shadow: 0 20px 70px #0008; }
.settings-dialog::backdrop { background: #0006; }
header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #222634; }
h2 { margin: 0; font-size: 15px; font-weight: 500; } h2 span { color: #9eacbd; } header button { display: flex; padding: 2px; background: transparent; border: 0; }
.settings-content { display: grid; grid-template-columns: 155px minmax(0, 1fr); min-height: 350px; }
nav { padding: 6px 0; border-right: 1px solid #354052; background: #181c26; }
.indicator-item { display: flex; align-items: center; gap: 5px; padding: 4px 9px; }.indicator-item.selected { background: #223f50; }
.indicator-item button { flex: 1; text-align: left; border: 0; background: transparent; padding: 7px 0; }
input[type=checkbox] { accent-color: #199fdb; width: 15px; height: 15px; margin: 0; }
.settings-editor { min-width: 0; padding: 15px 18px; }
h3 { margin: 0 0 12px; font-size: 14px; color: #49b7e5; font-weight: 500; }
.description { min-height: 68px; margin: 0 0 14px; padding: 10px; border: 1px solid #343d4f; background: #11151d; line-height: 1.7; font-size: 12px; }
.ma-table { width: 100%; border-collapse: collapse; } th { text-align: left; font-weight: 400; color: #91a1b6; padding: 4px; }
td { padding: 5px 4px; } td label { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
input[type=number] { box-sizing: border-box; width: 100%; max-width: 92px; padding: 5px; border: 1px solid #384156; border-radius: 3px; background: #10141c; color: #d5deeb; }
input[type=color] { width: 45px; height: 27px; padding: 2px; border: 1px solid #384156; background: #10141c; }
.settings-fields { display: grid; gap: 12px; }.settings-fields label { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.signal-toggle { display: flex; align-items: center; gap: 8px; margin-top: 16px; color: #ff9f43; }
.settings-error { color: #ff747b; font-size: 12px; }.settings-help { margin-top: 16px; font-size: 11px; color: #8593a8; line-height: 1.6; }
footer, footer > div { display: flex; align-items: center; gap: 8px; } footer { justify-content: space-between; padding: 12px 14px; border-top: 1px solid #343d4f; }
footer button { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }.apply-button { background: #165a7b; border-color: #2384ad; color: #dcf2ff; }
@media(max-width: 550px) { .settings-content { grid-template-columns: 110px minmax(0, 1fr); } .settings-editor { padding: 12px 8px; } .indicator-item { padding-inline: 5px; } .ma-table { font-size: 11px; } td { padding-inline: 2px; } input[type=color] { width: 30px; } footer { flex-wrap: wrap; } }
</style>
