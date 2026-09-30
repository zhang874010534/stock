import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive, ref } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createObservationNotes, provideObservationNotes } from '../src/composables/useObservationNotes.js'
import { useKlineFullscreen } from '../src/components/kline/useKlineFullscreen.js'
import { MAX_BACKUP_BYTES } from '../src/utils/observationNotes.js'

async function mount(name, initial, store) {
  const file = new URL(`../src/components/kline/${name}.vue`, import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'notes-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const previousDocumentClass = globalThis.Document, previousShadowClass = globalThis.ShadowRoot
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const node = tag => ({ tag, children: [], props: {}, text: '', value: '', clientWidth: 600,
    addEventListener() {}, getRootNode: () => ({}),
    focus(options) { this.focused = options ?? true }, scrollIntoView() {}, getBoundingClientRect: () => ({ left: 10, top: 20 }) })
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, oldValue, value) => { n.props[key] = value },
  })
  const host = node('host'), props = reactive(initial), componentRef = ref(null)
  const app = renderer.createApp({ setup() {
    if (store) provideObservationNotes(store)
    return () => h(component, { ...props, ref: componentRef })
  } })
  app.mount(host)
  const all = n => [n, ...n.children.flatMap(all)]
  return { props, api: componentRef.value, unmount: () => {
    app.unmount(); globalThis.Document = previousDocumentClass; globalThis.ShadowRoot = previousShadowClass
  }, nodes: () => all(host),
    text: () => all(host).map(n => n.text).join(' '), field: name => all(host).find(n => n.props['aria-label'] === name) }
}

test('笔记表单保存空价格、渲染纯文本、编辑及删除撤销；位置选择采用证券价格精度', async () => {
  const entries = new Map()
  let sequence = 0
  const store = createObservationNotes({ storage: { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) }, id: () => `component-note-${++sequence}` })
  let cancels = 0
  const view = await mount('KLineNotesPanel', { instrument: '512890', notes: [], defaultPoint: { date: '2026-09-29', price: 1.18 }, onCancelPick: () => cancels++ }, store)
  try {
    view.field('笔记日期').props['onUpdate:modelValue']('2026-09-15')
    view.field('观察内容').props['onUpdate:modelValue']('<img src=x>\n观察')
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} })
    await nextTick()
    assert.equal(store.notes.value.length, 1)
    assert.equal(store.notes.value[0].price, null)
    assert.equal(createObservationNotes({ storage: { getItem: key => entries.get(key) } }).notes.value.length, 1)
    view.props.notes = store.notes.value.map(note => ({ ...note, label: 'N1', point: null }))
    await nextTick()
    assert.match(view.text(), /<img src=x>/)
    assert.ok(!view.nodes().some(n => n.tag === 'img'))
    assert.match(view.text(), /该日期暂无已同步行情/)
    assert.equal(view.nodes().find(n => n.tag === 'button' && n.text === '定位').props.disabled, true)
    view.api.editNote('component-note-1')
    await nextTick()
    assert.equal(view.field('观察内容').value, '<img src=x>\n观察')
    assert.match(view.text(), /编辑已有笔记/)
    await view.api.selectPoint({ date: '2026-09-28', price: 1.176960749 })
    assert.equal(view.field('笔记价格').value, '1.177')
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} })
    await nextTick()
    assert.equal(store.notes.value[0].price, 1.177)
    assert.equal(store.notes.value[0].date, '2026-09-28')
    view.api.editNote('component-note-1')
    // Vue's native number input v-model yields a number after typing.
    view.field('笔记价格').props['onUpdate:modelValue'](1.205)
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} })
    await nextTick()
    assert.equal(store.notes.value[0].price, 1.205)
    view.props.instrument = 'H30269'
    await nextTick()
    view.api.newNote({ date: '2026-09-29', price: 10000 })
    await view.api.selectPoint({ date: '2026-09-29', price: 10987.65432 })
    view.field('观察内容').props['onUpdate:modelValue']('指数笔记')
    view.nodes().find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} })
    assert.equal(store.notes.value.find(note => note.instrument === 'H30269').price, 10987.65)
    view.field('删除 N1 笔记').props.onClick()
    await nextTick()
    assert.equal(store.notes.value.length, 1)
    view.nodes().find(n => n.tag === 'button' && n.text === '撤销最近一次删除').props.onClick()
    assert.equal(store.notes.value.length, 2)
    assert.ok(cancels > 0)
  } finally { view.unmount() }
})

test('笔记文件导入拒绝损坏或过大备份，恢复输入以便重试，不改变已有记录', async () => {
  const store = createObservationNotes({ storage: { getItem: () => null, setItem() {} }, id: () => 'original' })
  store.upsert({ instrument: '512890', date: '2026-09-29', price: null, text: '保留' })
  const view = await mount('KLineNotesPanel', { instrument: '512890', notes: [] }, store)
  try {
    const input = view.field('选择笔记备份文件')
    const invalid = { files: [{ size: 10, text: async () => '{bad' }], value: 'file.json' }
    await input.props.onChange({ target: invalid }); await nextTick()
    assert.match(view.text(), /导入失败/)
    assert.equal(invalid.value, '')
    assert.equal(store.notes.value[0].text, '保留')
    const oversized = { files: [{ size: MAX_BACKUP_BYTES + 1, text() { throw new Error('must not read') } }], value: 'large.json' }
    await input.props.onChange({ target: oversized }); await nextTick()
    assert.match(view.text(), /不能超过 8 MB/)
    const valid = { files: [{ size: 500, text: async () => store.exportBackup() }], value: 'valid.json' }
    await input.props.onChange({ target: valid }); await nextTick()
    assert.match(view.text(), /备份已合并/)
    assert.ok(!view.text().includes('导入失败'))
    assert.equal(store.notes.value.length, 1)
  } finally { view.unmount() }
})

test('笔记标记按价格网格裁剪，缩放后重新投影，键盘可打开，选择点忽略无效价格', async () => {
  const previousObserver = globalThis.ResizeObserver
  let disconnected = false, selected, picked
  globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected = true } }
  let view
  try {
    view = await mount('KLineNotesOverlay', { notes: [
      { id: 'visible', label: 'N1', date: '2026-09-29', price: null, text: '记录', point: { x: 100, y: 100 } },
      { id: 'outside', label: 'N2', point: { x: 5, y: 100 } },
      { id: 'high', label: 'N3', point: { x: 100, y: 1000 } },
      { id: 'missing', label: 'N4', point: null },
    ], layout: { left: 40, right: 20, priceTop: 30, priceHeight: 200 }, revision: 1,
    pointToPixel: point => point, pointAtPixel: (x, y) => ({ date: '2026-09-28', price: y, x }), picking: false,
    onSelect: id => { selected = id }, onPoint: point => { picked = point } })
    assert.deepEqual(view.api.visibleNotes().map(note => note.id), ['visible'])
    const marker = view.field('N1 2026-09-29：记录')
    marker.props.onKeydown[0]({ key: 'Enter', preventDefault() {} })
    assert.equal(selected, 'visible')
    view.props.picking = true; await nextTick()
    const surface = view.nodes().find(n => n.props.class === 'note-pick-surface')
    surface.props.onPointerdown({ button: 0, clientX: 110, clientY: 120, stopPropagation() {}, preventDefault() {} })
    assert.deepEqual(picked, { date: '2026-09-28', price: 100, x: 100 })
    surface.props.onPointerdown({ button: 0, clientX: 110, clientY: 10, stopPropagation() {}, preventDefault() {} })
    assert.equal(picked.price, 100)
    view.props.pointToPixel = point => ({ x: point.x + 600, y: point.y }); view.props.revision++
    await nextTick()
    assert.equal(view.api.visibleNotes().length, 0)
  } finally { view?.unmount(); globalThis.ResizeObserver = previousObserver }
  assert.equal(disconnected, true)
})

test('全屏 Escape 先取消位置选择；下一次才退出，并将笔记文本框纳入焦点循环', async () => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window
  let keydown, cancel = true, api, selector
  const input = { getClientRects: () => [1], focus() {} }
  const textarea = { getClientRects: () => [1], focus() {} }
  const button = { getClientRects: () => [1], focus() {} }
  globalThis.document = { body: { style: { overflow: '', paddingRight: '' } }, documentElement: { clientWidth: 600 }, activeElement: input,
    addEventListener(type, listener) { keydown = listener }, removeEventListener() {} }
  globalThis.window = { innerWidth: 600 }
  const panel = { getBoundingClientRect: () => ({ height: 500 }), focus() {}, querySelectorAll(value) { selector = value; return [input, textarea, button] } }
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { api = useKlineFullscreen(ref(panel), () => {}, () => { const result = cancel; cancel = false; return result }); return () => null } })
  try {
    app.mount({}); await api.toggle()
    keydown({ key: 'Escape', target: {}, preventDefault() {}, stopPropagation() {} })
    assert.equal(api.expanded.value, true)
    globalThis.document.activeElement = textarea
    let prevented = false
    keydown({ key: 'Tab', target: {}, preventDefault() { prevented = true } })
    assert.match(selector, /textarea:not\(:disabled\)/)
    assert.equal(prevented, false)
    keydown({ key: 'Escape', target: {}, preventDefault() {}, stopPropagation() {} })
    await nextTick()
    assert.equal(api.expanded.value, false)
    assert.equal(document.body.style.overflow, '')
  } finally { app.unmount(); globalThis.document = previousDocument; globalThis.window = previousWindow }
})
