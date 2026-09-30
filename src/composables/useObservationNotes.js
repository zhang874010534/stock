import { computed, inject, provide, ref } from 'vue'
import { mergeNotes, notesDocument, NOTES_KEY, validateNote, validateNotesDocument } from '../utils/observationNotes.js'

const notesKey = Symbol('observation-notes')
export function createObservationNotes({ storage, now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
  const notes = ref([]), removed = ref(null), error = ref(''), notice = ref('')
  const getStorage = () => storage ?? globalThis.localStorage
  let readable = true
  try {
    const raw = getStorage()?.getItem(NOTES_KEY)
    if (raw != null) notes.value = validateNotesDocument(JSON.parse(raw))
  } catch { readable = false; error.value = '无法读取本机笔记。为保留原记录，当前修改只留在页面中，可导出备份。' }
  function save(message) {
    notice.value = message
    if (!readable) return
    try {
      const target = getStorage()
      if (!target) throw new Error('Storage unavailable')
      target.setItem(NOTES_KEY, JSON.stringify(notesDocument(notes.value)))
      error.value = ''
    } catch { error.value = '本机笔记保存失败，当前修改仅留在页面中，请导出备份。' }
  }
  function upsert(input) {
    const previous = input.id ? notes.value.find(note => note.id === input.id) : null
    if (input.id && (!previous || previous.instrument !== input.instrument)) throw new Error('待编辑笔记已不存在')
    const time = new Date(Math.max(now().getTime(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
    const note = validateNote({ ...input, id: previous?.id ?? id(), createdAt: previous?.createdAt ?? time, updatedAt: time })
    const updated = notes.value.filter(item => item.id !== note.id)
    notes.value = mergeNotes(updated, [note])
    save('笔记已保存到本机。')
    return note
  }
  function remove(noteId) {
    const item = notes.value.find(note => note.id === noteId)
    if (!item) return
    removed.value = { ...item }
    notes.value = notes.value.filter(note => note.id !== noteId)
    save('笔记已删除，可撤销最近一次删除。')
  }
  function undoRemove() {
    if (!removed.value) return
    notes.value = mergeNotes(notes.value, [removed.value])
    removed.value = null
    save('已恢复删除的笔记。')
  }
  function importBackup(text) {
    const incoming = validateNotesDocument(JSON.parse(text))
    notes.value = mergeNotes(notes.value, incoming)
    save('备份已合并；同编号笔记保留更新时间较新的内容。')
  }
  return { notes, removed, message: computed(() => error.value || notice.value), upsert, remove, undoRemove, importBackup,
    exportBackup: () => JSON.stringify(notesDocument(notes.value, now().toISOString()), null, 2) }
}
export function provideObservationNotes(notes = createObservationNotes()) { provide(notesKey, notes); return notes }
export function useObservationNotes() { return inject(notesKey, null) ?? createObservationNotes() }
