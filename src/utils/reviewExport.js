import { formatReviewMetric, reviewTitle, validateReviewSummary } from './reviewSummary.js'

// Render text directly to canvas: no remote assets, HTML screenshots, or
// truncated personal notes. Markdown is available when a full PNG is too tall.
export async function createReviewPng(input, { createCanvas = () => document.createElement('canvas') } = {}) {
  const report = validateReviewSummary(input), canvas = createCanvas(), context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法生成复盘图片')
  const width = 1120, padding = 48, contentWidth = width - padding * 2
  const font = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif'
  const blocks = []
  const add = (text, size = 19, color = '#aabbd2', gap = 10) => blocks.push({ text: String(text), size, color, gap })
  add('红利低波 · 复盘摘要', 30, '#e8f1ff', 12)
  add(reviewTitle(report), 22, '#86dce4', 10)
  add(`${report.period.ongoing ? '周期进行中' : '完整自然周期'} · 汇总截至 ${report.period.asOf} · 生成 ${report.createdAt}`, 16, '#91a4bf', 24)
  for (const metric of report.metrics) {
    add(`${metric.label}   ${formatReviewMetric(metric)}`, 24, '#d7e8ff', 8)
    add(metric.detail, 18, '#9baec8', 20)
  }
  add('成分变化', 25, '#86dce4', 14)
  for (const line of report.constituents) add(line)
  add(`我的观察笔记 · ${report.notes.length} 条`, 25, '#86dce4', 14)
  if (!report.notes.length) add('本区间没有该证券的观察笔记。')
  for (const note of report.notes) {
    add(`${note.date}${note.price === null ? '' : ` · 记录价格 ${note.price}`}`, 19, '#e2ecfa', 8)
    add(note.text, 19, '#aabbd2', 18)
  }
  add('我的复盘感想', 25, '#86dce4', 14)
  add(report.reflection || '暂无补充感想。', 19, '#c2d2e7', 22)
  add('数据状态与口径', 23, '#d8ba83', 14)
  for (const line of [...report.warnings, ...report.methodology]) add(line, 17, '#9baec8', 10)
  add('行情：东方财富 · 估值：东方财富 H30269 · 成分：中证 H30269 · 本机保存的个人笔记', 15, '#7890ae', 0)
  function wrap(text, size) {
    context.font = `${size}px ${font}`
    const lines = []
    for (const paragraph of text.split(/\r?\n/)) {
      let line = ''
      for (const character of paragraph) {
        if (line && context.measureText(line + character).width > contentWidth) { lines.push(line); line = '' }
        line += character
      }
      lines.push(line)
    }
    return lines
  }
  const layout = blocks.map(block => ({ ...block, lines: wrap(block.text, block.size), step: Math.ceil(block.size * 1.65) }))
  const height = padding * 2 + layout.reduce((sum, block) => sum + block.lines.length * block.step + block.gap, 0)
  if (height > 14000 || width * height * 4 > 64_000_000) throw new Error('完整摘要过长，无法生成一张图片；请导出 Markdown，所有笔记会完整保留')
  canvas.width = width; canvas.height = height
  context.fillStyle = '#0b1424'; context.fillRect(0, 0, width, height)
  context.fillStyle = '#408cff'; context.fillRect(0, 0, 8, height)
  let y = padding
  for (const block of layout) {
    context.font = `${block.size}px ${font}`; context.fillStyle = block.color
    for (const line of block.lines) { context.fillText(line, padding, y + block.size); y += block.step }
    y += block.gap
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('复盘 PNG 生成失败')), 'image/png'))
}
