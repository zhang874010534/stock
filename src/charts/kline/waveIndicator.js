import { calculateWaveSignals } from '../../utils/waveSignals.js'
import { createLineSeries } from './series.js'

export const WAVE_PARAMETERS = { zigPercent: 10, sellPeriod: 3 }
export const waveDefinition = {
  label: '波段信号', parameters: WAVE_PARAMETERS,
  parameterFields: [
    { key: 'zigPercent', label: 'ZIG 转向幅度（%）', min: 1, max: 80, step: 1 },
    { key: 'sellPeriod', label: '卖线均线周期', min: 1, max: 30, step: 1 },
  ],
  title: ({ zigPercent, sellPeriod }) => `波段信号(${zigPercent},${sellPeriod})`,
  calculate: calculateWaveSignals,
  createLines: values => [{ id: 'wave-ma5', name: 'MA5', color: '#f060f0', data: values.ma5, type: 'line' }],
  createSeries(lines, axisIndex, values, history) {
    const axis = { xAxisIndex: axisIndex, yAxisIndex: axisIndex }
    const bands = values.events.flatMap((events, i) => events.flatMap(event => {
      const base = values.base[i], p = history[i]
      const ranges = {
        '游资进': [base * .96, base + .2], '抄底': [base * .92, base],
        '精准买': [p.low * .98, p.close], '短买点': [base * .92, base * .98],
        '奔牛': [base * .96, base], '黑马': [base * .96, base],
        '波段买': [base * .96, base], '波段卖': [p.high * 1.01, p.high * 1.03],
        '大黑马': [base * .92, base],
      }
      const range = ranges[event.name]
      if (!range) return []
      return [{ value: [p.date, ...range], itemStyle: { color: event.color } }]
    }))
    const marks = values.events.flatMap((events, i) => events.map(event => {
      const letter = event.name === '转向买' ? 'B' : event.name === '转向卖' ? 'S' : null
      const color = letter === 'B' ? '#ff454f' : letter === 'S' ? '#00be65' : event.color
      return {
        value: [history[i].date, event.price], name: event.name,
        ...(letter ? { symbol: 'circle', symbolSize: 1 } : {}),
        symbolRotate: event.side === 'sell' ? 180 : 0,
        itemStyle: { color: letter ? 'transparent' : color },
        label: {
          color, position: letter ? 'inside' : event.side === 'sell' ? 'top' : 'bottom',
          ...(letter ? {
            formatter: letter, fontSize: 14, fontWeight: 'bold',
            offset: [-16, 0], backgroundColor: '#101116', padding: [2, 3],
          } : {}),
        },
      }
    }))
    return [
      { id: 'wave-candles', name: '趋势K线', type: 'candlestick', ...axis, barMaxWidth: 14,
        data: history.map((p, i) => {
          const color = values.bullish[i] ? '#ff454f' : '#00be65'
          return { value: [p.open, p.close, p.low, p.high], itemStyle: { color, color0: color, borderColor: color, borderColor0: color } }
        }), emphasis: { disabled: true } },
      ...lines.map(line => createLineSeries(line, axisIndex)),
      { id: 'wave-bands', name: '信号色柱', type: 'custom', ...axis, data: bands,
        encode: { x: 0, y: [1, 2] }, silent: true,
        renderItem: (params, api) => {
          const a = api.coord([api.value(0), api.value(1)]), b = api.coord([api.value(0), api.value(2)])
          const width = Math.max(1, Math.min(9, api.size([1, 0])[0] * .8))
          const top = Math.max(params.coordSys.y, Math.min(a[1], b[1]))
          const bottom = Math.min(params.coordSys.y + params.coordSys.height, Math.max(a[1], b[1]))
          if (bottom <= top) return
          return { type: 'rect', shape: { x: a[0] - width / 2, y: top, width, height: bottom - top }, style: { fill: api.visual('color'), opacity: .65 } }
        } },
      { id: 'wave-signals', name: '波段标记', type: 'scatter', ...axis, data: marks.filter(mark => !mark.label.formatter),
        symbol: 'triangle', symbolSize: 7, clip: true,
        label: { show: true, formatter: '{b}', fontSize: 9 }, labelLayout: { hideOverlap: true }, emphasis: { scale: false } },
      // B/S must remain visible even when several formula signals share the same bar.
      { id: 'wave-turning-signals', name: '转向买卖', type: 'scatter', ...axis,
        data: marks.filter(mark => mark.label.formatter), z: 10, clip: true,
        label: { show: true }, labelLayout: { hideOverlap: false }, emphasis: { scale: false } },
      { id: 'wave-vertical', name: '共振竖线', type: 'custom', ...axis,
        data: history.flatMap((p, i) => values.vertical[i] ? [[p.date, p.low * .90, p.high * 1.06]] : []),
        encode: { x: 0, y: [1, 2] }, silent: true,
        renderItem: (params, api) => {
          const start = api.coord([api.value(0), api.value(1)])
          return { type: 'line', shape: { x1: start[0], y1: params.coordSys.y + params.coordSys.height, x2: start[0], y2: params.coordSys.y }, style: { stroke: '#ff454f', opacity: .35, lineWidth: 1 } }
        } },
    ]
  },
}
