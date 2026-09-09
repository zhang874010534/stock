import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'

// Mount the real SFC with Vue's renderer; emulate only the host's pointer/focus APIs.
test('水平线单击放置、预览、保存重载、隐藏和删除，兼容旧平行线', async () => {
  const file = new URL('../src/components/kline/KLineDrawingTools.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'selection-test', inlineTemplate: true }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)}'`)
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const listeners = new Map()
  globalThis.window = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  globalThis.document = { activeElement: { focus() {} } }
  const storage = new Map()
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  const all = node => [node, ...node.children.flatMap(all)]
  function node(tag) {
    return { tag, children: [], props: {}, clientWidth: 800, clientHeight: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture(id) { this.pointer = id }, releasePointerCapture() { this.pointer = null }, hasPointerCapture(id) { return this.pointer === id },
      focus() { document.activeElement = this },
      querySelector(selector) { return this.querySelectorAll(selector)[0] },
      querySelectorAll(selector) { return all(this).filter(item => item.tag === selector) },
    }
  }
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child) },
    remove(child) { const items = child.parent.children; items.splice(items.indexOf(child), 1) },
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
    patchProp: (node, key, oldValue, value) => { node.props[key] = value },
  })
  const key = 'stock:parallel-lines:v1:512890:day'
  const legacy = { id: 'old', points: [{ date: 'a', price: 10 }, { date: 'b', price: 20 }, { date: 'c', price: 30 }] }
  storage.set(key, JSON.stringify([legacy]))
  const props = { instrument: '512890', period: 'day', revision: 0,
    layout: { left: 60, right: 48, priceTop: 8, priceHeight: 300 },
    pointAtPixel: (x, y) => ({ date: 'a', price: y / 10 }),
    pointToPixel: point => ({ x: point.date === 'a' ? 100 : 200, y: point.price * 10 }),
    priceToPixel: price => price * 10,
  }
  let app = renderer.createApp(Component, props)
  let host = node('host')
  const find = label => all(host).find(n => n.props['aria-label'] === label)
  const lines = () => all(host).filter(n => n.props.class === 'drawn-line')
  const surface = () => all(host).find(n => n.props.class === 'draw-surface')
  const event = { button: 0, clientX: 300, clientY: 120, stopPropagation() {}, preventDefault() {} }
  try {
    app.mount(host)
    await nextTick()
    find('绘制水平线').props.onClick()
    await nextTick()
    surface().props.onPointermove(event)
    await nextTick()
    assert.ok(lines().some(n => n.props['stroke-dasharray'] === '5 4' && n.props.y1 === 120))
    surface().props.onPointerdown(event)
    await nextTick()
    assert.equal(surface(), undefined)
    const saved = JSON.parse(storage.get(key))
    assert.deepEqual(saved[0], legacy)
    assert.equal(saved[1].type, 'horizontal')
    assert.equal(saved[1].price, 12)
    app.unmount()
    app = renderer.createApp(Component, props)
    host = node('host')
    app.mount(host)
    await nextTick()
    assert.ok(lines().some(n => n.props.x1 === 60 && n.props.x2 === 752 && n.props.y1 === 120 && n.props.y2 === 120))
    find('隐藏画线').props.onClick()
    await nextTick()
    assert.equal(lines().length, 0)
    find('隐藏画线').props.onClick()
    await nextTick()
    all(host).find(n => n.props.class === 'hit-line' && n.props.y1 === 120).props.onPointerdown(event)
    await nextTick()
    find('删除选中画线').props.onClick()
    await nextTick()
    assert.deepEqual(JSON.parse(storage.get(key)), [legacy])
    find('绘制水平线').props.onClick()
    await nextTick()
    find('取消本次画线').props.onClick()
    await nextTick()
    assert.equal(surface(), undefined)
  } finally {
    app.unmount()
    assert.equal(listeners.size, 0)
    delete globalThis.window
    delete globalThis.document
    delete globalThis.localStorage
    delete globalThis.ResizeObserver
  }
})
