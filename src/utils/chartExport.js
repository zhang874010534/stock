import { KLINE_PERIODS } from './kline.js'

export function chartExportMetadata({ instrument, period, chartType, history, dailyHistory, window, indicators = [], warning = '' }) {
  const first = history[Math.max(0, window.startIndex)], last = history[Math.min(history.length - 1, window.endIndex)]
  if (!first || !last) throw new Error('当前查看区间没有可导出的行情')
  const isEtf = instrument === '512890'
  const start = first.startDate ?? first.date, end = last.endDate ?? last.date
  const dataDate = dailyHistory.at(-1)?.date
  if (!dataDate) throw new Error('缺少行情数据日期')
  return {
    filename: `${instrument}_${period}_${chartType}_${start}_${end}.png`,
    title: `${instrument} · ${isEtf ? '华泰柏瑞红利低波ETF' : '中证红利低波动指数'} · ${KLINE_PERIODS.find(item => item.key === period)?.label ?? period} · ${chartType === 'line' ? '折线' : 'K线'}`,
    lines: [`查看区间：${start} — ${end}；来源：东方财富；行情数据日期：${dataDate}`, `已同步日线：${dailyHistory[0].date} — ${dataDate}；${isEtf ? '未复权价格，不含现金分红' : '价格指数，不含分红再投资'}；非实时行情。`,
      ...(indicators.length ? [`指标：${indicators.join(' · ')}`] : []), ...(warning ? [`读取状态：${warning}`] : [])],
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// SVG overlays depend on scoped CSS. Inline the rendered styles so an exported
// image includes annotations without requiring page CSS or interactive controls.
export function serializeOverlay(svg, excluded = '') {
  if (!svg) return null
  const clone = svg.cloneNode(true)
  const originals = [svg, ...svg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')]
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'paint-order']
  copies.forEach((element, index) => {
    const style = getComputedStyle(originals[index])
    properties.forEach(property => element.style.setProperty(property, style.getPropertyValue(property)))
  })
  if (excluded) clone.querySelectorAll(excluded).forEach(element => element.remove())
  const { width, height } = svg.getBoundingClientRect()
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', width); clone.setAttribute('height', height)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图表图像生成失败'))
    image.src = url
  })
}
export async function createChartPng({ image, overlays = [], metadata, notes = [], exportedAt = new Date() }) {
  const images = await Promise.all([image, ...overlays.filter(Boolean)].map(loadImage))
  const width = images[0].naturalWidth, height = images[0].naturalHeight
  if (!width || !height) throw new Error('图表尺寸无效')
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法生成 PNG')
  const font = '"Microsoft YaHei", "Segoe UI", sans-serif', contentWidth = Math.max(1, width - 32)
  function wrap(text, size) {
    context.font = `${size}px ${font}`
    const lines = []; let line = ''
    for (const character of text) {
      if (line && (character === '\n' || context.measureText(line + character).width > contentWidth)) { lines.push(line); line = '' }
      if (character !== '\n') line += character
    }
    if (line) lines.push(line)
    return lines
  }
  const title = wrap(metadata.title, 16), header = metadata.lines.flatMap(line => wrap(line, 12))
  const noteLines = notes.slice(0, 20).flatMap(note => wrap(`${note.label} · ${note.date}${note.price === null ? '' : ` · 价格 ${note.price}`} · ${note.text.slice(0, 80)}${note.text.length > 80 ? '…' : ''}`, 11))
  const footer = [...noteLines, ...wrap(`可见笔记 ${notes.length} 条${notes.length ? '；图中按 N 编号标记，最多列出前 20 条、每条前 80 字，完整内容见笔记 JSON 备份' : ''}。`, 11), ...wrap(`导出时间：${exportedAt.toISOString()}`, 11)]
  const headerHeight = 24 + title.length * 24 + header.length * 18 + 12, footerHeight = 16 + footer.length * 17 + 12
  const totalHeight = headerHeight + height + footerHeight
  if (width * totalHeight * 4 > 50_000_000 || totalHeight * 2 > 16000) throw new Error('导出图像过大，请缩小图表后重试')
  canvas.width = Math.ceil(width * 2); canvas.height = Math.ceil(totalHeight * 2)
  context.scale(2, 2); context.fillStyle = '#101116'; context.fillRect(0, 0, width, totalHeight)
  let y = 24
  function draw(lines, size, step, color) {
    context.font = `${size}px ${font}`; context.fillStyle = color
    for (const line of lines) { context.fillText(line, 16, y); y += step }
  }
  draw(title, 16, 24, '#e4e6ec'); draw(header, 12, 18, '#a7b3c6')
  for (const image of images) context.drawImage(image, 0, headerHeight, width, height)
  y = headerHeight + height + 20
  draw(footer, 11, 17, '#a7b3c6')
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 导出失败')), 'image/png'))
}
