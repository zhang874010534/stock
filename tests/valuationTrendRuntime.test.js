import test from 'node:test'
import assert from 'node:assert/strict'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { initValuationTrend } from '../src/charts/valuationTrendRuntime.js'
import { valuationTrendOption } from '../src/charts/valuationTrend.js'
import { valuationStats } from '../src/utils/valuationStats.js'

// Use SVG SSR for rendering without a browser; production retains Canvas.
// Import only the valuation runtime so other charts cannot mask missing registrations.
use([SVGRenderer])

test('valuation runtime renders the line, quantiles and expanded zoom without full ECharts', () => {
  const stats = valuationStats(Array.from({ length: 30 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`, pe: i + 1,
  })), 'pe', 'all')
  const chart = initValuationTrend(null, { renderer: 'svg', ssr: true, width: 800, height: 400 })
  try {
    chart.setOption(valuationTrendOption(stats, 'pe', true), { notMerge: true })
    const model = chart.getModel()
    assert.equal(model.getSeriesByIndex(0).subType, 'line')
    assert.ok(model.getComponent('grid'))
    assert.ok(model.getComponent('tooltip'))
    assert.ok(model.getComponent('markLine'))
    assert.equal(model.getComponent('dataZoom', 0).subType, 'inside')
    assert.equal(model.getComponent('dataZoom', 1).subType, 'slider')
    const svg = chart.renderToSVGString()
    assert.match(svg, /<path/)
    assert.match(svg, /#ef697c/)
    assert.match(svg, /#34c79a/)
    chart.dispatchAction({ type: 'dataZoom', start: 25, end: 75 })
    assert.equal(chart.getOption().dataZoom[0].start, 25)
    chart.setOption(valuationTrendOption(stats, 'pb', false), { notMerge: true })
    assert.equal(chart.getOption().dataZoom.length, 0)
    assert.match(chart.renderToSVGString(), /<path/)
  } finally {
    chart.dispose()
  }
})
