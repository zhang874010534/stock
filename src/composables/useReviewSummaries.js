import { ref } from 'vue'
import { MAX_REVIEWS, REVIEWS_KEY, validateReviewSummary, validateReviewsDocument } from '../utils/reviewSummary.js'

export function createReviewSummaries({ storage, id = () => crypto.randomUUID() } = {}) {
  const reviews = ref([]), removed = ref(null), message = ref('')
  const getStorage = () => storage ?? globalThis.localStorage
  let readable = true
  try {
    const raw = getStorage()?.getItem(REVIEWS_KEY)
    if (raw !== null && raw !== undefined) reviews.value = validateReviewsDocument(JSON.parse(raw)).reviews
  } catch { readable = false; message.value = '本机复盘历史读取失败。为保留原记录，当前保存仅留在页面中，请导出。' }
  function persist() {
    if (!readable) return
    try {
      const target = getStorage()
      if (!target) throw new Error('Storage unavailable')
      target.setItem(REVIEWS_KEY, JSON.stringify(validateReviewsDocument({ schemaVersion: 1, kind: 'stock-review-history', reviews: reviews.value })))
      message.value = '复盘已保存到当前浏览器。'
    } catch { message.value = '本机复盘保存失败，当前历史仅留在页面中，请导出图片或 Markdown。' }
  }
  function save(report) {
    if (reviews.value.length >= MAX_REVIEWS) throw new Error(`最多保存 ${MAX_REVIEWS} 份复盘，请先删除不需要的历史（可撤销）`)
    // Copy every field: later notes edits, refreshes, or draft changes cannot
    // mutate the saved snapshot.
    const snapshot = validateReviewSummary({ ...report, id: id() })
    if (reviews.value.some(item => item.id === snapshot.id)) throw new Error('复盘编号重复，请重试')
    reviews.value = [snapshot, ...reviews.value]
    persist(); return snapshot
  }
  function remove(reportId) {
    const report = reviews.value.find(item => item.id === reportId)
    if (!report) return
    removed.value = validateReviewSummary(report)
    reviews.value = reviews.value.filter(item => item.id !== reportId)
    persist()
  }
  function undoRemove() {
    if (!removed.value) return
    if (reviews.value.length >= MAX_REVIEWS) throw new Error('历史已达到保存上限，暂不能恢复')
    if (reviews.value.some(item => item.id === removed.value.id)) throw new Error('已有相同编号，不能重复恢复')
    reviews.value = [removed.value, ...reviews.value]; removed.value = null; persist()
  }
  return { reviews, removed, message, save, remove, undoRemove }
}
