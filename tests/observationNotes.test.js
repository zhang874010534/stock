import test from 'node:test'
import assert from 'node:assert/strict'
import { createObservationNotes } from '../src/composables/useObservationNotes.js'
import { mergeNotes, notesDocument, NOTES_KEY, projectNotes, validateNotesDocument } from '../src/utils/observationNotes.js'
import { chartExportMetadata } from '../src/utils/chartExport.js'
import { aggregateKlines } from '../src/utils/kline.js'

function memoryStorage(initial = []) {
  const entries = new Map(initial)
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
}
const timestamp = '2026-09-30T12:00:00.000Z'
const note = (overrides = {}) => ({ id: 'note-1', instrument: '512890', date: '2026-09-29', price: null, text: '观察记录', createdAt: timestamp, updatedAt: timestamp, ...overrides })
const daily = ['2026-09-28', '2026-09-29', '2026-09-30'].map((date, i) => ({ date, open: i + 1, close: i + 1, high: i + 1, low: i + 1 }))

test('笔记本地保存、证券隔离、重新创建恢复、编辑、删除及撤销，不影响偏好或画线', () => {
  const storage = memoryStorage([['stock:preferences:v1', 'keep'], ['stock:parallel-lines:v1:512890:day', 'keep-lines']])
  let counter = 0
  const store = createObservationNotes({ storage, now: () => new Date(timestamp), id: () => `id-${++counter}` })
  const first = store.upsert({ instrument: '512890', date: '2026-09-29', price: null, text: '  第一条\n观察  ' })
  store.upsert({ instrument: 'H30269', date: '2026-09-28', price: 10800, text: '指数笔记' })
  const reopened = createObservationNotes({ storage })
  assert.equal(reopened.notes.value.length, 2)
  assert.equal(reopened.notes.value[0].text, '第一条\n观察')
  store.upsert({ ...first, text: '编辑后的笔记' })
  assert.equal(store.notes.value[0].text, '指数笔记')
  assert.equal(store.notes.value[1].createdAt, timestamp)
  assert.ok(store.notes.value[1].updatedAt > first.updatedAt)
  store.remove(first.id)
  assert.equal(store.notes.value.length, 1)
  store.undoRemove()
  assert.equal(store.notes.value.length, 2)
  assert.equal(store.removed.value, null)
  assert.equal(storage.entries.get('stock:preferences:v1'), 'keep')
  assert.equal(storage.entries.get('stock:parallel-lines:v1:512890:day'), 'keep-lines')
})

test('备份含全部证券、格式版本和导出时间；导入同编号保留较新内容，重复导入不重复', () => {
  const store = createObservationNotes({ storage: memoryStorage(), now: () => new Date(timestamp) })
  store.importBackup(JSON.stringify(notesDocument([note(), note({ id: 'note-2', instrument: 'H30269' })])))
  const exported = JSON.parse(store.exportBackup())
  assert.equal(exported.exportedAt, timestamp)
  assert.equal(exported.schemaVersion, 1)
  assert.deepEqual(exported.notes.map(item => item.instrument), ['512890', 'H30269'])
  const newer = note({ text: '更新', updatedAt: '2026-10-01T00:00:00.000Z' })
  store.importBackup(JSON.stringify(notesDocument([newer])))
  store.importBackup(JSON.stringify(exported))
  store.importBackup(JSON.stringify(exported))
  assert.equal(store.notes.value.length, 2)
  assert.equal(store.notes.value.find(item => item.id === 'note-1').text, '更新')
  const before = structuredClone(exported.notes)
  assert.throws(() => mergeNotes(before, [note({ instrument: 'H30269' })]))
  assert.deepEqual(before, exported.notes)
})

test('损坏备份、非法价格、日期、内容、编号和过量笔记整体拒绝，不改变已有记录', () => {
  const store = createObservationNotes({ storage: memoryStorage() })
  store.importBackup(JSON.stringify(notesDocument([note()])))
  const invalid = [
    { schemaVersion: 2, kind: 'stock-observation-notes', notes: [] },
    { schemaVersion: 1, kind: 'wrong', notes: [] },
    ...[{ price: -1 }, { price: '1' }, { date: '2026-02-30' }, { text: '' }, { text: 'x'.repeat(2001) },
      { instrument: 'unknown' }, { id: '<script>' }, { createdAt: 'invalid' }].map(patch => ({ schemaVersion: 1, kind: 'stock-observation-notes', notes: [note(patch)] })),
    { schemaVersion: 1, kind: 'stock-observation-notes', notes: [note(), note()] },
    { schemaVersion: 1, kind: 'stock-observation-notes', notes: Array.from({ length: 1001 }, (_, i) => note({ id: `note-${i}` })) },
  ]
  const previous = JSON.stringify(store.notes.value)
  for (const document of invalid) {
    assert.throws(() => store.importBackup(JSON.stringify(document)))
    assert.equal(JSON.stringify(store.notes.value), previous)
  }
  assert.throws(() => store.importBackup('{bad'))
  assert.equal(JSON.stringify(store.notes.value), previous)
  assert.throws(() => store.upsert({ id: 'missing', instrument: '512890' }))
})

test('无法保存时保留页面中笔记并能导出；损坏存储不被覆盖', () => {
  const storage = memoryStorage([[NOTES_KEY, '{bad']])
  const broken = createObservationNotes({ storage, now: () => new Date(timestamp), id: () => 'new-note' })
  assert.match(broken.message.value, /无法读取/)
  broken.upsert({ instrument: '512890', date: '2026-09-29', price: 1.2, text: '仍可备份' })
  assert.equal(storage.getItem(NOTES_KEY), '{bad')
  assert.equal(validateNotesDocument(JSON.parse(broken.exportBackup())).length, 1)
  const denied = createObservationNotes({ storage: { getItem: () => null, setItem() { throw new Error('quota') } }, now: () => new Date(timestamp), id: () => 'new-note' })
  denied.upsert({ instrument: '512890', date: '2026-09-29', price: null, text: '仅留页面' })
  assert.match(denied.message.value, /保存失败/)
  assert.equal(validateNotesDocument(JSON.parse(denied.exportBackup())).length, 1)
})

test('笔记安全保留文本，日日期映射到所在周月季 K 线，缺失日期不生成标记', () => {
  const notes = [note({ text: '<img src=x onerror=alert(1)>' }), note({ id: 'priced', date: '2026-09-28', price: 10 }), note({ id: 'missing', date: '2026-09-27' })]
  for (const period of ['day', 'week', 'month', 'quarter']) {
    const bars = aggregateKlines(daily, period)
    const projected = projectNotes(notes, daily, bars)
    assert.equal(projected[0].label, 'N1')
    assert.equal(projected[0].point.price, 2)
    assert.equal(projected[0].point.date, period === 'day' ? '2026-09-29' : '2026-09-30')
    assert.equal(projected[1].point.price, 10)
    assert.equal(projected[2].point, null)
    assert.equal(projected[0].date, '2026-09-29')
    assert.equal(projected[0].text, notes[0].text)
  }
})

test('图表元信息使用实际聚合区间、日线日期和证券口径，不将空白栏当作未来数据', () => {
  const bars = aggregateKlines(daily, 'week')
  const metadata = chartExportMetadata({ instrument: '512890', period: 'week', chartType: 'line', history: bars, dailyHistory: daily, window: { startIndex: 0, endIndex: 100 }, indicators: ['MA30', 'KDJ(9,3,3)'], warning: '后台更新失败' })
  assert.match(metadata.title, /512890.*周线.*折线/)
  assert.match(metadata.filename, /2026-09-28_2026-09-30\.png$/)
  assert.match(metadata.lines.join('\n'), /行情数据日期：2026-09-30/)
  assert.match(metadata.lines.join('\n'), /未复权价格，不含现金分红/)
  assert.match(metadata.lines.join('\n'), /后台更新失败/)
  assert.match(metadata.lines.join('\n'), /KDJ\(9,3,3\)/)
  const index = chartExportMetadata({ instrument: 'H30269', period: 'day', chartType: 'candlestick', history: daily, dailyHistory: daily, window: { startIndex: 1, endIndex: 2 } })
  assert.match(index.lines[0], /2026-09-29 — 2026-09-30/)
  assert.match(index.lines[1], /价格指数，不含分红再投资/)
  assert.throws(() => chartExportMetadata({ instrument: '512890', history: [], dailyHistory: [], window: { startIndex: 0, endIndex: 0 } }))
})
