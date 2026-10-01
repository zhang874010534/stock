import { computed, inject, provide, ref } from 'vue'
import { LEDGER_KEY, MAX_LEDGER_BACKUP_BYTES, ledgerDocument, validateLedgerDocument, validateLedgerEntry } from '../utils/portfolioLedger.js'

const ledgerKey = Symbol('portfolio-ledger')
export function createPortfolioLedger({ storage, now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
  const entries = ref([]), removed = ref(null), error = ref(''), notice = ref(''), selectedId = ref(null)
  const getStorage = () => storage ?? globalThis.localStorage
  const options = () => ({ now: now() })
  let readable = true
  try {
    const raw = getStorage()?.getItem(LEDGER_KEY)
    if (raw != null) entries.value = validateLedgerDocument(JSON.parse(raw), options())
  } catch { readable = false; error.value = '本机账本无法读取，原存储不会被覆盖。当前修改仅留在页面中，请导出备份。' }
  function commit(candidate, message) {
    const document = ledgerDocument(candidate, options())
    entries.value = document.entries
    notice.value = message
    if (!readable) return
    try {
      const target = getStorage()
      if (!target) throw new Error('Storage unavailable')
      target.setItem(LEDGER_KEY, JSON.stringify(document)); error.value = ''
    } catch { error.value = '账本保存失败，当前修改仅留在页面中，请导出备份。' }
  }
  function upsert(input) {
    const previous = input.id ? entries.value.find(entry => entry.id === input.id) : null
    if (input.id && !previous) throw new Error('待编辑记录已不存在')
    const time = new Date(Math.max(now().getTime(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
    const entry = validateLedgerEntry({ ...input, instrument: '512890', id: previous?.id ?? id(), createdAt: previous?.createdAt ?? time, updatedAt: time }, options())
    commit([...entries.value.filter(item => item.id !== entry.id), entry], '记录已保存到当前浏览器。')
    return entry
  }
  function remove(entryId) {
    const previous = entries.value.find(entry => entry.id === entryId)
    if (!previous) return
    commit(entries.value.filter(entry => entry.id !== entryId), '记录已删除，可撤销最近一次删除。')
    removed.value = { ...previous }
    if (selectedId.value === entryId) selectedId.value = null
  }
  function undoRemove() {
    if (!removed.value) return
    commit([...entries.value, removed.value], '已恢复删除的记录。'); removed.value = null
  }
  function importBackup(text) {
    if (new TextEncoder().encode(text).length > MAX_LEDGER_BACKUP_BYTES) throw new Error('账本备份不能超过 4 MB')
    const incoming = validateLedgerDocument(JSON.parse(text), options())
    const byId = new Map(entries.value.map(entry => [entry.id, entry]))
    for (const entry of incoming) {
      const previous = byId.get(entry.id)
      if (!previous || entry.updatedAt > previous.updatedAt) byId.set(entry.id, entry)
      else if (entry.updatedAt === previous.updatedAt && JSON.stringify(entry) !== JSON.stringify(previous)) throw new Error('同编号同更新时间的记录内容冲突，请核对备份')
    }
    commit([...byId.values()], '账本备份已合并；同编号记录采用更新时间较新的版本。')
  }
  return { entries, removed, selectedId, message: computed(() => error.value || notice.value), upsert, remove, undoRemove, importBackup,
    select: entryId => { selectedId.value = entryId },
    exportBackup: () => JSON.stringify({ ...ledgerDocument(entries.value, options()), exportedAt: now().toISOString() }, null, 2) }
}
export function providePortfolioLedger(ledger = createPortfolioLedger()) { provide(ledgerKey, ledger); return ledger }
export function usePortfolioLedger() { return inject(ledgerKey, null) ?? createPortfolioLedger() }
