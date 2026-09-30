<script setup>
import { nextTick, ref } from 'vue'
import { useObservationNotes } from '../../composables/useObservationNotes.js'
import { downloadBlob } from '../../utils/chartExport.js'
import { MAX_BACKUP_BYTES, MAX_NOTE_LENGTH } from '../../utils/observationNotes.js'
import { formatIndexValue } from '../../utils/indexHistory.js'

const props = defineProps({ instrument: String, notes: { type: Array, default: () => [] }, defaultPoint: Object, picking: Boolean })
const emit = defineEmits(['pick', 'cancel-pick', 'locate'])
const store = useObservationNotes()
const heading = ref(null), dateInput = ref(null), textInput = ref(null), fileInput = ref(null), error = ref(''), importing = ref(false)
const draft = ref({ id: '', date: props.defaultPoint?.date ?? '', price: '', text: '' })
function newNote(point = props.defaultPoint) {
  emit('cancel-pick')
  draft.value = { id: '', date: point?.date ?? '', price: point?.price == null ? '' : String(point.price), text: '' }
  error.value = ''
}
function editNote(noteId) {
  const note = props.notes.find(item => item.id === noteId)
  if (!note) return
  emit('cancel-pick')
  draft.value = { id: note.id, date: note.date, price: note.price === null ? '' : String(note.price), text: note.text }
  error.value = ''
}
async function selectPoint(point) {
  draft.value.date = point.date
  draft.value.price = String(Number(point.price.toFixed(props.instrument === '512890' ? 3 : 2)))
  await nextTick(); textInput.value?.focus()
}
function focusEditor() {
  heading.value?.scrollIntoView({ block: 'start' })
  dateInput.value?.focus({ preventScroll: true })
}
function saveNote() {
  try {
    store.upsert({ ...draft.value, instrument: props.instrument, price: String(draft.value.price).trim() === '' ? null : Number(draft.value.price) })
    newNote()
  } catch (reason) { error.value = reason.message }
}
function removeNote(noteId) {
  store.remove(noteId)
  if (draft.value.id === noteId) newNote()
}
function undoDelete() {
  try { store.undoRemove(); error.value = '' }
  catch (reason) { error.value = reason.message }
}
function backup() {
  try {
    downloadBlob(new Blob([store.exportBackup()], { type: 'application/json;charset=utf-8' }), `observation-notes-${new Date().toISOString().slice(0, 10)}.json`)
    error.value = ''
  } catch (reason) { error.value = reason.message }
}
async function importFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  importing.value = true
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('笔记备份不能超过 8 MB')
    store.importBackup(await file.text())
    error.value = ''
  } catch (reason) { error.value = `导入失败：${reason.message}` }
  finally { importing.value = false; event.target.value = '' }
}
defineExpose({ newNote, editNote, selectPoint, focusEditor })
</script>

<template>
  <section class="notes-panel" aria-label="观察笔记">
    <div ref="heading" class="notes-heading"><h3>{{ instrument }} 观察笔记</h3><button type="button" @click="newNote()">新建笔记</button></div>
    <p class="notes-caption">保存在当前浏览器。按日期记录，可选填写价格；日／周／月／季图共用同一份笔记。</p>
    <form class="note-form" @submit.prevent="saveNote">
      <label>日期<input ref="dateInput" v-model="draft.date" type="date" required aria-label="笔记日期" /></label>
      <label>价格（可选）<input v-model="draft.price" type="number" step="any" min="0" aria-label="笔记价格" placeholder="留空则按当日收盘定位" /></label>
      <button type="button" :aria-pressed="picking" @click="picking ? emit('cancel-pick') : emit('pick')">{{ picking ? '取消选位置（Esc）' : '在图上选位置' }}</button>
      <label>观察内容<textarea ref="textInput" v-model="draft.text" required :maxlength="MAX_NOTE_LENGTH" rows="4" aria-label="观察内容" placeholder="记录观察、假设或待核验事项" /></label>
      <p class="notes-caption">{{ draft.text.length }} / {{ MAX_NOTE_LENGTH }} · {{ draft.id ? '编辑已有笔记' : '新笔记' }}</p>
      <div class="note-actions"><button type="submit" class="primary">保存笔记</button><button v-if="draft.id" type="button" @click="newNote()">取消编辑</button></div>
    </form>
    <p v-if="error" class="notes-status" role="status">{{ error }}</p>
    <p v-if="store.message.value" class="notes-status" role="status">{{ store.message.value }}</p>
    <div class="backup-actions"><button type="button" @click="backup">导出全部笔记备份</button><button type="button" :disabled="importing" @click="fileInput?.click()">{{ importing ? '导入中…' : '导入笔记备份' }}</button><input ref="fileInput" type="file" accept=".json,application/json" hidden aria-label="选择笔记备份文件" @change="importFile" /></div>
    <p class="notes-caption">JSON 备份包含两只证券的全部笔记；导入合并，相同编号保留较新内容。</p>
    <button v-if="store.removed.value" type="button" class="undo-delete" @click="undoDelete">撤销最近一次删除</button>
    <p class="notes-caption">当前证券 {{ notes.length }} 条。超出日期或价格可视范围的标记暂不显示，笔记仍保留。</p>
    <p v-if="!notes.length" class="notes-caption">暂无观察笔记。</p>
    <article v-for="note in notes" :key="note.id" class="note-entry">
      <header><strong>{{ note.label }} · {{ note.date }}</strong><span v-if="note.price !== null">{{ formatIndexValue(note.price, instrument === '512890' ? 3 : 2) }} {{ instrument === '512890' ? '元' : '点' }}</span></header>
      <p class="note-content">{{ note.text }}</p>
      <p v-if="!note.point" class="notes-caption">该日期暂无已同步行情，笔记仍已保留。</p>
      <div class="note-actions"><button type="button" :disabled="!note.point" @click="emit('locate', note)">定位</button><button type="button" :aria-label="`编辑 ${note.label} 笔记`" @click="editNote(note.id)">编辑</button><button type="button" :aria-label="`删除 ${note.label} 笔记`" @click="removeNote(note.id)">删除</button></div>
    </article>
  </section>
</template>

<style scoped>
.notes-panel { padding-block: 12px; }
.notes-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h3 { font-size: 13px; color: #dbe6f6; }
button, input, textarea { border: 1px solid #354159; border-radius: 4px; background: #111923; color: #bfcde0; font: inherit; font-size: 11px; }
button { padding: 5px 7px; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.notes-caption { margin-top: 8px; color: #899cb7; font-size: 10px; line-height: 1.7; }
.note-form { display: grid; gap: 8px; margin-top: 12px; }
label { display: grid; gap: 5px; color: #a2b3cd; font-size: 11px; }
input, textarea { width: 100%; padding: 7px; min-width: 0; }
textarea { resize: vertical; }
.note-actions, .backup-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.backup-actions { margin-top: 14px; }
.primary { background: #193044; border-color: #426380; color: #dceeff; }
.notes-status { color: #d5b57f; font-size: 11px; line-height: 1.7; margin-top: 8px; }
.undo-delete { margin-top: 9px; }
.note-entry { border-top: 1px solid #2a364c; padding: 12px 0; margin-top: 8px; }
.note-entry header { display: flex; flex-wrap: wrap; gap: 6px; color: #b9cce9; font-size: 11px; }
.note-content { color: #c5cede; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; margin-block: 8px; }
@media (max-width: 900px) {
  .notes-heading { scroll-margin-top: 110px; }
}
</style>
