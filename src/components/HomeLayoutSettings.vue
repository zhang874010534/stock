<script setup>
import { computed, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Settings2 } from 'lucide-vue-next'
import { useHomeLayout } from '../composables/useHomeLayout.js'
import { availableHomeModules, HOME_PRESETS, MAX_HOME_LAYOUTS } from '../utils/homeLayout.js'

const props = defineProps({ instrument: { type: String, default: '512890' } })
const layouts = useHomeLayout(), expanded = ref(false), name = ref(''), actionError = ref('')
const current = computed(() => layouts.current(props.instrument))
const modules = computed(() => availableHomeModules(current.value.modules, props.instrument))
const saved = computed(() => layouts.state.saved.filter(item => item.instrument === props.instrument))
const selected = computed(() => layouts.sourceLayout(props.instrument))
const visibleCount = computed(() => modules.value.filter(module => !module.hidden).length)
watch(() => [props.instrument, current.value.source, selected.value?.name], () => { name.value = selected.value?.name ?? ''; actionError.value = '' }, { immediate: true })
function act(action) { try { action(); actionError.value = '' } catch (error) { actionError.value = error.message } }
</script>
<template>
  <section id="homepage-layout" class="home-layout-settings panel" aria-labelledby="homepage-layout-title">
    <div class="layout-heading"><div><h2 id="homepage-layout-title">首页布局 <small>{{ instrument }} · {{ visibleCount }} / {{ modules.length }} 个模块显示</small></h2><p>{{ layouts.sourceName(instrument) }}{{ layouts.dirty(instrument) ? ' · 已调整' : '' }} · 当前排列自动保存在本机</p></div><div class="layout-actions"><label class="layout-picker">切换布局<select aria-label="切换首页布局" :value="current.source" @change="act(() => layouts.apply(instrument, $event.target.value))"><option v-for="preset in HOME_PRESETS" :key="preset.id" :value="preset.id">{{ preset.name }}</option><option v-if="current.source === 'custom'" value="custom" disabled>自定义排列</option><optgroup v-if="saved.length" label="我保存的布局"><option v-for="item in saved" :key="item.id" :value="item.id">{{ item.name }}</option></optgroup></select></label><button type="button" :aria-expanded="expanded" aria-controls="homepage-layout-editor" @click="expanded = !expanded"><Settings2 :size="14" />{{ expanded ? '收起设置' : '自定义首页' }}</button></div></div>
    <p v-if="layouts.hasWarning.value" class="layout-warning" role="status">{{ layouts.message.value }}</p>
    <div v-show="expanded" id="homepage-layout-editor" class="layout-editor">
      <p class="layout-note">调整模块的显示、折叠和顺序；上移／下移也支持键盘操作。折叠和隐藏保留模块内的当前编辑与查看状态。</p>
      <p v-if="instrument === 'H30269'" class="layout-note">个人账本与 ETF 分红、净值模块仅在 512890 页面提供，两只证券的布局分别保存。</p>
      <div class="layout-save"><label>布局名称<input v-model="name" maxlength="24" aria-label="首页布局名称" placeholder="例如：我的持仓观察" /></label><div class="layout-actions"><button type="button" :disabled="layouts.state.saved.length >= MAX_HOME_LAYOUTS" @click="act(() => layouts.saveAs(instrument, name))">另存为新布局</button><button type="button" :disabled="!selected" @click="act(() => layouts.updateSaved(instrument, name))">更新所选布局</button><button type="button" :disabled="!selected" @click="act(() => layouts.removeSaved(instrument))">删除所选布局</button></div></div>
      <div class="layout-actions"><button v-if="layouts.previous.value?.instrument === instrument" type="button" @click="act(() => layouts.undoApply(instrument))">撤销布局切换</button><button v-if="layouts.removed.value" type="button" @click="act(() => layouts.undoRemove())">撤销删除布局</button><button type="button" @click="act(() => layouts.apply(instrument, 'all'))">恢复默认首页</button><span class="layout-note">已保存 {{ layouts.state.saved.length }} / {{ MAX_HOME_LAYOUTS }} 个命名布局</span></div>
      <p v-if="actionError" class="layout-warning" role="alert">{{ actionError }}</p><p v-else-if="layouts.message.value && !layouts.hasWarning.value" class="layout-note" role="status">{{ layouts.message.value }}</p>
      <ol class="layout-modules"><li v-for="(module, index) in modules" :key="module.id" :class="{ muted: module.hidden }"><div class="module-label"><span class="module-number">{{ index + 1 }}</span><strong>{{ module.label }}</strong><small>{{ module.hidden ? '已隐藏' : module.collapsed ? '已折叠' : '已显示' }}</small></div><div class="module-options"><label><input type="checkbox" :checked="!module.hidden" :aria-label="`显示${module.label}`" @change="layouts.configure(instrument, module.id, 'hidden', !$event.target.checked)" />显示</label><label><input type="checkbox" :checked="module.collapsed" :aria-label="`默认折叠${module.label}`" @change="layouts.configure(instrument, module.id, 'collapsed', $event.target.checked)" />折叠</label><button type="button" :disabled="index === 0" :aria-label="`上移${module.label}`" @click="layouts.move(instrument, module.id, -1)"><ArrowUp :size="14" /><span>上移</span></button><button type="button" :disabled="index === modules.length - 1" :aria-label="`下移${module.label}`" @click="layouts.move(instrument, module.id, 1)"><ArrowDown :size="14" /><span>下移</span></button></div></li></ol>
    </div>
    <p v-if="!visibleCount" class="layout-warning">所有模块已隐藏。打开“自定义首页”勾选模块，或切换到“默认全览”。</p>
  </section>
</template>
<style scoped>
.home-layout-settings { padding: 15px 18px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); } .layout-heading, .layout-actions, .module-label, .module-options { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; } .layout-heading { justify-content: space-between; }
h2 { font-size: 14px; } h2 small { display: inline-block; margin-left: 7px; font-size: 10px; color: #93a4bf; font-weight: 400; } .layout-heading p, .layout-note { color: #93a4bf; font-size: 11px; line-height: 1.8; } .layout-heading p { margin-top: 5px; }
button, select, input[type=text], input:not([type]) { border: 1px solid #334963; border-radius: 5px; padding: 7px 9px; color: #c7d8f2; background: #111d30; font: inherit; font-size: 11px; min-width: 0; } button { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; } button:disabled { opacity: .4; cursor: default; } .layout-picker { display: flex; align-items: center; gap: 7px; color: #93a4bf; font-size: 11px; } select { max-width: 190px; }
.layout-editor { margin-top: 14px; border-top: 1px solid #263a55; padding-top: 12px; } .layout-save { display: flex; align-items: end; flex-wrap: wrap; gap: 10px 14px; margin: 12px 0; } .layout-save > label { color: #b7cbea; font-size: 11px; } .layout-save input { display: block; margin-top: 5px; width: 220px; max-width: 100%; box-sizing: border-box; }
.layout-modules { list-style: none; padding: 0; margin-top: 12px; display: grid; gap: 7px; } .layout-modules li { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 9px 12px; background: #0a1426; border: 1px solid #263a55; border-radius: 6px; } .module-number { font-variant-numeric: tabular-nums; color: #8198b9; width: 18px; } .module-label strong { color: #c7d8f2; font-size: 12px; font-weight: 500; } .module-label small { color: #8198b9; font-size: 10px; } .module-options label { display: inline-flex; align-items: center; gap: 5px; color: #acbed8; font-size: 11px; } input[type=checkbox] { accent-color: #408cff; } .muted .module-label { opacity: .65; }
.layout-warning { color: #e4bf83; font-size: 11px; line-height: 1.8; margin-top: 9px; overflow-wrap: anywhere; } button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
@media (max-width: 640px) { .home-layout-settings { padding: 13px 12px; } h2 small { display: block; margin: 5px 0 0; } .layout-modules li { align-items: flex-start; } .module-options { width: 100%; justify-content: flex-end; gap: 8px; } .module-options button { padding: 6px; } .layout-save { align-items: flex-start; } .layout-save > label { width: 100%; } .layout-save input { width: 100%; } }
</style>
