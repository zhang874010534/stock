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
  assert.equal(checkCalendar({ now: '2012-12-30T00:00:00Z' }).level, 'error')
})

test('calendar check rejects unsupported extension and malformed closure ranges', () => {
  for (const patch of [
    { end: '2027-12-31' },
    { end: '2026-12-30' },
    { annualSources: {} },
    { closures: [['2026-02-30', '2026-03-01']] },
    { closures: [...tradingCalendar.closures, ['2026-10-07', '2026-10-08']] },
    { closures: [['2012-01-01', '2012-01-02']] },
    { supplementarySources: ['https://example.com/holiday.shtml'] },
  ]) assert.equal(checkCalendar({ calendar: { ...tradingCalendar, ...patch }, now: '2026-09-29' }).level, 'error')
})

test('historical holidays, temporary closures and make-up weekends use the official sessions', () => {
  const boundaries = [
    ['2013-01-03', '2013-01-04'], ['2014-02-06', '2014-02-07'],
    ['2015-09-04', '2015-09-07'], ['2016-06-10', '2016-06-13'],
    ['2017-05-30', '2017-05-31'], ['2018-02-21', '2018-02-22'],
    ['2019-05-03', '2019-05-06'], ['2020-01-31', '2020-02-03'],
    ['2018-12-31', '2019-01-02'],
    ['2021-09-21', '2021-09-22'], ['2022-05-04', '2022-05-05'],
  ]
  for (const [closed, open] of boundaries) {
    assert.equal(isTradingDay(closed), false, closed)
    assert.equal(isTradingDay(open), true, open)
  }
  for (const weekend of ['2013-01-05', '2014-02-08', '2015-09-06', '2016-02-14',
    '2017-05-27', '2018-04-08', '2019-05-05', '2020-06-28', '2021-09-18', '2022-10-08']) {
    assert.equal(isTradingDay(weekend), false, weekend)
  }
  assert.equal(isTradingDay('2013-12-19'), true)
  assert.equal(isTradingDay('2022-12-30'), true)
  assert.equal(isTradingDay('2023-01-03'), true)
  assert.ok(tradingCalendar.sources.includes(tradingCalendar.supplementarySources[2]))
})

test('uncovered years remain unknown and cannot be treated as trading days', () => {
  assert.equal(dataFreshness('2026-12-31', { now: new Date('2027-01-04T12:00:00Z') }).level, 'unknown')
  assert.throws(() => isTradingDay('2027-01-04'), /交易日历待核验/)
  assert.equal(isTradingDay('2026-09-20'), false)
  assert.equal(isTradingDay('2026-10-01'), false)
  assert.equal(isTradingDay('2026-10-08'), true)
})
