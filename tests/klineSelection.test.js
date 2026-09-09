import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'

// Mount the real SFC with Vue's renderer; emulate only the host's pointer/focus APIs.
test('右键正反向框选可统计和放大，左键不框选，Escape取消并清理监听', async () => {
  const file = new URL('../src/components/kline/KLineRangeSelection.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'selection-test', inlineTemplate: true }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)}'`)
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const listeners = new Map()
  globalThis.window = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  globalThis.document = { activeElement: { focus() {} } }
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
  const history = Array.from({ length: 10 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, open: 10, close: 10 + i, high: 20, low: 9 }))
  const zooms = []
  const app = renderer.createApp(Component, { history, enabled: true, instrument: '512890', periodLabel: '日线',
    layout: { left: 60, right: 16, priceTop: 8, priceHeight: 300 }, visibleWindow: { startIndex: 0, endIndex: 9 },
    indexAtPixel: x => Math.max(0, Math.min(9, Math.round((x - 60) / 70))), onZoom: (...args) => zooms.push(args),
  })
  const host = node('host')
  try {
    app.mount(host)
    const root = host.children[0]
    const find = role => all(root).find(n => n.props.role === role)
    const event = (x, button = 2) => ({ button, pointerId: 1, clientX: x, clientY: 100, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} })
    root.props.onPointerdownCapture(event(130, 0))
    await nextTick()
    assert.equal(find('menu'), undefined)
    const drag = async (from, to) => {
      root.props.onPointerdownCapture(event(from))
      await nextTick()
      root.props.onPointermoveCapture(event(to))
      await root.props.onPointerupCapture(event(to))
      await nextTick()
      assert.ok(find('menu'))
    }
    await drag(130, 410)
    await find('menu').querySelectorAll('button')[0].props.onClick()
    assert.ok(find('dialog'))
    assert.ok(all(find('dialog')).some(n => n.text === '5'))
    let escaped = false
    listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() { escaped = true } })
    await nextTick()
    assert.ok(escaped)
    assert.equal(find('dialog'), undefined)
    await drag(410, 130)
    find('menu').querySelectorAll('button')[1].props.onClick()
    await nextTick()
    assert.deepEqual(zooms, [[1, 5]])
    assert.equal(find('menu'), undefined)
  } finally {
    app.unmount()
    assert.equal(listeners.size, 0)
    delete globalThis.window
    delete globalThis.document
  }
})
