export function etfLiquidityOption(stats, kind = 'liquidity') {
  const size = kind === 'size', points = size ? stats.history : stats.points
  const axes = size ? [0] : [0, 1]
  const definitions = size ? [{ key: 'netAssets', name: '报告期资产净值', color: '#69a9ff', axis: 0, scale: 1e8 }]
    : [{ key: 'amount', name: '每日成交额', color: '#69a9ff', axis: 0, scale: 1e8 }, { key: 'amount20', name: '20日均成交额', color: '#e1bd69', axis: 0, scale: 1e8 },
      { key: 'turnover', name: '每日场内换手率', color: '#63d0b0', axis: 1, scale: 1 }, { key: 'turnover20', name: '20日均换手率', color: '#bd9aef', axis: 1, scale: 1 }]
  return { animation: false, textStyle: { color: '#959baa' }, legend: { top: 4, textStyle: { color: '#aebcd1', fontSize: 10 }, itemWidth: 15, itemHeight: 8 },
    grid: size ? [{ left: 65, right: 22, top: 55, bottom: 65 }] : [{ left: 65, right: 22, top: 65, height: '28%' }, { left: 65, right: 22, top: '56%', height: '25%' }],
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' }, formatter(params) {
      const index = (Array.isArray(params) ? params[0] : params)?.dataIndex, point = points[index]
      if (!point) return ''
      return `${point.date}<br/>${definitions.map(item => `${item.name}：${Number.isFinite(point[item.key]) ? `${(point[item.key] / item.scale).toFixed(2)}${item.axis === 1 ? '%' : ' 亿元'}` : '—（缺样本）'}`).join('<br/>')}`
    } }, axisPointer: { link: [{ xAxisIndex: 'all' }] },
    xAxis: axes.map(axis => ({ type: 'category', gridIndex: axis, data: points.map(point => point.date), boundaryGap: false, axisLabel: { hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#383d49' } } })),
    yAxis: axes.map(axis => ({ type: 'value', gridIndex: axis, name: axis === 1 ? '换手率 %' : '亿元', scale: true, axisLabel: { formatter: value => Number(value.toFixed(2)) }, splitLine: { lineStyle: { color: '#252832' } } })),
    dataZoom: [{ type: 'inside', xAxisIndex: axes, zoomOnMouseWheel: false, moveOnMouseWheel: false }, { type: 'slider', xAxisIndex: axes, bottom: 10, height: 20, borderColor: '#383d49', textStyle: { color: '#959baa' } }],
    series: definitions.map(item => ({ name: item.name, type: 'line', xAxisIndex: item.axis, yAxisIndex: item.axis, data: points.map(point => Number.isFinite(point[item.key]) ? point[item.key] / item.scale : null), connectNulls: false, showSymbol: size || points.length < 15,
      lineStyle: { width: 1.7, type: item.key.endsWith('20') || size ? 'dashed' : 'solid' }, itemStyle: { color: item.color } })),
  }
}
