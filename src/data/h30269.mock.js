// 仅用于图表界面和交互验收，不是 H30269 真实行情。
// 日期仅排除周末，不代表交易所节假日日历。固定种子确保每次展示一致。
function createDemoHistory() {
  let seed = 30269
  let close = 6600
  const points = []
  const end = Date.UTC(2026, 7, 31)

  for (let time = Date.UTC(2020, 4, 25); time <= end; time += 86400000) {
    const date = new Date(time)
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue

    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const noise = seed / 4294967296 - 0.5
    const cycle = Math.sin(points.length / 83) * 0.001
    close *= 1 + 0.00025 + cycle + noise * 0.024
    points.push({ date: date.toISOString().slice(0, 10), close })
  }

  const scale = 9852.36 / points.at(-1).close
  return points.map((point) => ({
    date: point.date,
    close: Number((point.close * scale).toFixed(2)),
  }))
}

export const h30269DemoHistory = createDemoHistory()
