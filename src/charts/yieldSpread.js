export function yieldSpreadOption(analysis) {
  const colors = ['#68b0ff', '#b69cf6', '#58ccb1']
  return {
    animation: false, textStyle: { color: '#9babbe' },
    legend: { top: 2, data: ['指数股息率', '十年期国债收益率', '差值'], textStyle: { color: '#b5c6df', fontSize: 11 } },
    grid: [{ left: 55, right: 18, top: 48, height: 170 }, { left: 55, right: 18, top: 277, height: 135 }],
    title: { text: '股息率 − 十年期国债收益率（百分点）', left: 10, top: 243, textStyle: { fontSize: 11, fontWeight: 400, color: '#b5c6df' } },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' }, formatter(params) {
      const point = analysis.points[params[0]?.dataIndex]
      if (!point) return ''
      return `${point.date}<br/>H30269 股息率：${point.dividend === null ? '缺失' : point.dividend.toFixed(2) + '%'}<br/>十年期国债：${point.treasury === null ? '缺失' : point.treasury.toFixed(4) + '%'}<br/>差值：${point.spread === null ? '缺少同日数据，不计算' : point.spread.toFixed(4) + ' 个百分点'}`
    } },
    xAxis: [0, 1].map(gridIndex => ({ gridIndex, type: 'category', data: analysis.points.map(point => point.date), boundaryGap: false, axisLabel: { hideOverlap: true, fontSize: 10 }, axisLine: { lineStyle: { color: '#383d49' } }, axisTick: { show: false } })),
    yAxis: [0, 1].map(gridIndex => ({ gridIndex, type: 'value', scale: true, axisLabel: { formatter: value => `${Number(value.toFixed(2))}${gridIndex ? '' : '%'}`, fontSize: 10 }, splitLine: { lineStyle: { color: '#252e3d' } } })),
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], zoomOnMouseWheel: false, moveOnMouseWheel: false }, { type: 'slider', xAxisIndex: [0, 1], top: 451, height: 18, showDetail: false, borderColor: '#383d49' }],
    series: [
      ...['dividend', 'treasury', 'spread'].map((key, index) => ({ id: `yield-${key}`, name: ['指数股息率', '十年期国债收益率', '差值'][index], type: 'line', xAxisIndex: index === 2 ? 1 : 0, yAxisIndex: index === 2 ? 1 : 0, data: analysis.points.map(point => point[key]), showSymbol: analysis.points.length < 40, symbolSize: 5, connectNulls: false, itemStyle: { color: colors[index] }, lineStyle: { width: 1.8 } })),
      { id: 'yield-zero', name: '零差值参考', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: analysis.points.map(() => 0), showSymbol: false, silent: true, lineStyle: { color: '#798da5', type: 'dashed', width: 1 }, tooltip: { show: false } },
    ],
  }
}
