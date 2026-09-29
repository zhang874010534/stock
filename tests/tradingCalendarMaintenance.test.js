import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCalendar } from '../scripts/check-trading-calendar.mjs'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { dataFreshness } from '../src/utils/sourceStatus.js'
import { isTradingDay } from '../src/utils/latestMetrics.js'

test('calendar check warns at 90 days and expires using Beijing midnight', () => {
  assert.equal(checkCalendar({ now: '2026-09-29T00:00:00Z' }).level, 'ok')
  const warning = checkCalendar({ now: '2026-10-02T00:00:00Z' })
  assert.equal(warning.remainingDays, 90)
  assert.equal(warning.level, 'warning')
  assert.equal(checkCalendar({ now: '2026-12-31T15:59:59Z' }).level, 'warning')
  assert.equal(checkCalendar({ now: '2026-12-31T16:00:00Z' }).level, 'error')
  assert.equal(checkCalendar({ now: '2022-12-30T00:00:00Z' }).level, 'error')
})

test('calendar check rejects unsupported extension and malformed closure ranges', () => {
  for (const patch of [
    { end: '2027-12-31' },
    { end: '2026-12-30' },
    { annualSources: {} },
    { closures: [['2026-02-30', '2026-03-01']] },
    { closures: [...tradingCalendar.closures, ['2026-10-07', '2026-10-08']] },
    { closures: [['2022-01-01', '2022-01-02']] },
  ]) assert.equal(checkCalendar({ calendar: { ...tradingCalendar, ...patch }, now: '2026-09-29' }).level, 'error')
})

test('uncovered years remain unknown and cannot be treated as trading days', () => {
  assert.equal(dataFreshness('2026-12-31', { now: new Date('2027-01-04T12:00:00Z') }).level, 'unknown')
  assert.throws(() => isTradingDay('2027-01-04'), /交易日历待核验/)
  assert.equal(isTradingDay('2026-09-20'), false)
  assert.equal(isTradingDay('2026-10-01'), false)
  assert.equal(isTradingDay('2026-10-08'), true)
})
