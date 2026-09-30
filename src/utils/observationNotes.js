export const NOTES_KEY = 'stock:observation-notes:v1'
export const MAX_NOTES = 1000
export const MAX_NOTE_LENGTH = 2000
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024
const instruments = ['H30269', '512890']

function requireValue(condition, message) { if (!condition) throw new Error(message) }
export function validNoteDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const time = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
}
function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
export function validateNote(note) {
  requireValue(note && typeof note === 'object', '笔记格式异常')
  requireValue(typeof note.id === 'string' && /^[\w-]{1,80}$/.test(note.id), '笔记编号异常')
  requireValue(instruments.includes(note.instrument), '笔记证券不受支持')
  requireValue(validNoteDate(note.date), '请选择有效的笔记日期')
  requireValue(note.price === null || (Number.isFinite(note.price) && note.price > 0), '笔记价格必须为正数，或留空')
  requireValue(typeof note.text === 'string' && note.text.trim().length > 0 && note.text.length <= MAX_NOTE_LENGTH, `笔记内容须为 1–${MAX_NOTE_LENGTH} 个字符`)
  requireValue(validTime(note.createdAt) && validTime(note.updatedAt) && note.updatedAt >= note.createdAt, '笔记记录时间异常')
  return { id: note.id, instrument: note.instrument, date: note.date, price: note.price, text: note.text.trim(), createdAt: note.createdAt, updatedAt: note.updatedAt }
}
export function validateNotesDocument(document) {
  requireValue(document?.schemaVersion === 1 && document.kind === 'stock-observation-notes', '不支持的笔记备份格式或版本')
  requireValue(Array.isArray(document.notes) && document.notes.length <= MAX_NOTES, `笔记数量不能超过 ${MAX_NOTES} 条`)
  const notes = document.notes.map(validateNote)
  requireValue(new Set(notes.map(note => note.id)).size === notes.length, '笔记编号重复')
  return notes
}
export function mergeNotes(existing, incoming) {
  const byId = new Map(existing.map(note => [note.id, validateNote(note)]))
  for (const source of incoming) {
    const note = validateNote(source), previous = byId.get(note.id)
    requireValue(!previous || previous.instrument === note.instrument, '相同笔记编号对应不同证券')
    if (!previous || note.updatedAt > previous.updatedAt) byId.set(note.id, note)
  }
  requireValue(byId.size <= MAX_NOTES, `合并后笔记不能超过 ${MAX_NOTES} 条`)
  return [...byId.values()]
}
export function notesDocument(notes, exportedAt) {
  const document = { schemaVersion: 1, kind: 'stock-observation-notes', notes, ...(exportedAt ? { exportedAt } : {}) }
  return { ...document, notes: validateNotesDocument(document) }
}

// An annotation needs an observed daily date. On weekly/monthly charts the
// marker belongs to the aggregated bar containing that day, never a fake date.
export function projectNotes(notes, dailyHistory, bars) {
  const daily = new Map(dailyHistory.map(row => [row.date, row]))
  return notes.map((note, index) => {
    const row = daily.get(note.date)
    const bar = row && bars.find(item => (item.startDate ?? item.date) <= note.date && (item.endDate ?? item.date) >= note.date)
    return { ...note, label: `N${index + 1}`, point: bar ? { date: bar.date, price: note.price ?? row.close } : null }
  })
}
