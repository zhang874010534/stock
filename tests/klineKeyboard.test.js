import test from 'node:test'
import assert from 'node:assert/strict'
import { getKeyboardKlineTarget } from '../src/utils/klineKeyboard.js'

test('左右逐根移动，越过可视边缘平移窗口并保留窗口宽度', () => {
  const window = { startIndex: 3, endIndex: 6 }
  assert.deepEqual(getKeyboardKlineTarget(10, 5, window, -1), { index: 4, window })
  assert.deepEqual(getKeyboardKlineTarget(10, 5, window, 1), { index: 6, window })
  assert.deepEqual(getKeyboardKlineTarget(10, 3, window, -1), { index: 2, window: { startIndex: 2, endIndex: 5 } })
  assert.deepEqual(getKeyboardKlineTarget(10, 6, window, 1), { index: 7, window: { startIndex: 4, endIndex: 7 } })
  assert.deepEqual(getKeyboardKlineTarget(10, 9, window, -1), { index: 5, window })
})

test('历史首尾停止移动，兼容空数据和单根K线', () => {
  const window = { startIndex: 0, endIndex: 9 }
  assert.deepEqual(getKeyboardKlineTarget(10, 0, window, -1), { index: 0, window })
  assert.deepEqual(getKeyboardKlineTarget(10, 9, window, 1), { index: 9, window })
  assert.equal(getKeyboardKlineTarget(0, -1, window, -1), null)
  for (const step of [-1, 1]) {
    assert.deepEqual(getKeyboardKlineTarget(1, 0, { startIndex: 0, endIndex: 0 }, step), {
      index: 0, window: { startIndex: 0, endIndex: 0 },
    })
  }
})
