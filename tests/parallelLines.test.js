import test from 'node:test'
import assert from 'node:assert/strict'
import { clipParallelLine, validParallelDrawing } from '../src/utils/parallelLines.js'

const rect = { left: 0, right: 100, top: 0, bottom: 100 }
test('平行线延伸并裁剪在主图内，第三点改变间距而不改变斜率', () => {
  const a = { x: 20, y: 30 }, b = { x: 60, y: 50 }, c = { x: 40, y: 70 }
  const baseline = clipParallelLine(a, b, a, rect)
  const parallel = clipParallelLine(a, b, c, rect)
  assert.deepEqual(baseline, { x1: 0, y1: 20, x2: 100, y2: 70 })
  assert.deepEqual(parallel, { x1: 0, y1: 50, x2: 100, y2: 100 })
  const scaled = point => ({ x: point.x * 2, y: point.y * 3 })
  const result = clipParallelLine(scaled(a), scaled(b), scaled(c), { left: 0, right: 200, top: 0, bottom: 300 })
  assert.deepEqual(result, { x1: 0, y1: 150, x2: 200, y2: 300 })
})
test('水平、垂直、重合点和画面外的线均正确处理', () => {
  assert.deepEqual(clipParallelLine({ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 15, y: 80 }, rect), { x1: 0, y1: 80, x2: 100, y2: 80 })
  assert.deepEqual(clipParallelLine({ x: 10, y: 20 }, { x: 10, y: 40 }, { x: 70, y: 50 }, rect), { x1: 70, y1: 0, x2: 70, y2: 100 })
  assert.equal(clipParallelLine({ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 70, y: 50 }, rect), null)
  assert.equal(clipParallelLine({ x: 10, y: 20 }, { x: 10, y: 40 }, { x: 170, y: 50 }, rect), null)
})
test('本机保存使用日期和价格，过滤无效或不完整的画线', () => {
  const item = { id: 'test', points: [{ date: '2026-09-01', price: 10 }, { date: '2026-09-02', price: 11 }, { date: '2026-09-03', price: 12 }] }
  assert.equal(validParallelDrawing(JSON.parse(JSON.stringify(item))), true)
  assert.equal(validParallelDrawing({ ...item, points: item.points.slice(0, 2) }), false)
  assert.equal(validParallelDrawing({ ...item, points: [item.points[0], item.points[0], item.points[2]] }), false)
  assert.equal(validParallelDrawing({ ...item, points: [item.points[0], item.points[1], { date: '2026-09-03', price: NaN }] }), false)
})
