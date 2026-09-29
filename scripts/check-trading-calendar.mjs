import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tradingCalendar } from '../src/data/tradingCalendar.js'

const DAY = 86_400_000
function timestamp(day) {
  const time = Date.parse(`${day}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) throw new Error(`无效日历日期：${day}`)
  return time
}

export function checkCalendar({ calendar = tradingCalendar, now = new Date() } = {}) {
  try {
    const start = timestamp(calendar.start), end = timestamp(calendar.end)
    if (start > end || !calendar.start.endsWith('-01-01') || !calendar.end.endsWith('-12-31')) throw new Error('日历须按完整年份维护')
    if (!Array.isArray(calendar.closures)) throw new Error('缺少休市区间')
    let previous = ''
    for (const interval of calendar.closures) {
      if (!Array.isArray(interval) || interval.length !== 2) throw new Error('休市区间格式异常')
      const [from, to] = interval
      if (timestamp(from) > timestamp(to) || from < calendar.start || to > calendar.end || from <= previous) throw new Error('休市区间重叠、未排序或超出覆盖')
      previous = to
    }
    for (let year = Number(calendar.start.slice(0, 4)); year <= Number(calendar.end.slice(0, 4)); year++) {
      const source = new URL(calendar.annualSources?.[year])
      if (source.protocol !== 'https:' || source.hostname !== 'www.sse.com.cn' || !source.pathname.endsWith('.shtml')) throw new Error(`${year} 年缺少官方公告来源`)
      if (!calendar.closures.some(([from]) => from.startsWith(`${year}-`))) throw new Error(`${year} 年没有已录入的休市安排`)
    }
    const today = new Date(new Date(now).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
    const remainingDays = (end - timestamp(today)) / DAY
    if (today < calendar.start || remainingDays < 0) return { level: 'error', remainingDays, message: `交易日历未覆盖北京时间 ${today}，现有覆盖 ${calendar.start} 至 ${calendar.end}；请按官方公告更新，见 docs/trading-calendar-maintenance.md。` }
    return { level: remainingDays <= 90 ? 'warning' : 'ok', remainingDays,
      message: `交易日历覆盖至 ${calendar.end}，剩余 ${remainingDays} 个自然日。${remainingDays <= 90 ? '请核验下一年度官方公告并安排更新，见 docs/trading-calendar-maintenance.md。' : ''}` }
  } catch (error) {
    return { level: 'error', message: `交易日历检查失败：${error.message}` }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = checkCalendar()
  console.log(result.message)
  if (process.env.GITHUB_ACTIONS && result.level !== 'ok') {
    const message = result.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    console.log(`::${result.level} title=Trading calendar::${message}`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n交易日历检查：${result.level}\n\n${result.message}\n`)
  if (result.level === 'error') process.exitCode = 1
}
