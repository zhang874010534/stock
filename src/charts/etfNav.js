const value = (number, suffix = '') => Number.isFinite(number) ? `${number.toFixed(4)}${suffix}` : '—'
export function etfNavOption(stats, kind) {
  const definitions = kind === 'price' ? [{ key: 'close', name: 'ETF 收盘价', color: '#69a9ff' }, { key: 'nav', name: '同日单位净值', color: '#63d0b0' }]
    : kind === 'premium' ? [{ key: 'premium', name: '折溢价', color: '#e1bd69' }]
      : [{ key: 'navReturn', name: '拆分调整净值变化', color: '#63d0b0' }, { key: 'indexReturn', name: 'H30269 价格指数变化', color: '#69a9ff' }, { key: 'deviation', name: '累计偏离（百分点）', color: '#bd9aef' }]
  const percent = kind !== 'price', points = stats.points
  return { animation: false, textStyle: { color: '#959baa', fontFamily: 'sans-serif' },
    legend: { top: 6, textStyle: { color: '#aebcd1', fontSize: 10 }, itemWidth: 15, itemHeight: 8 },
    grid: { left: 66, right: 20, top: 54, bottom: 65 },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' }, formatter(params) {
      const i = (Array.isArray(params) ? params[0] : params)?.dataIndex, point = points[i]
      if (!point) return ''
      return `${point.date}<br/>${definitions.map(item => `${item.name}：${value(point[item.key] === null ? null : point[item.key] * (percent ? 100 : 1), percent ? item.key === 'deviation' ? ' 个百分点' : '%' : ' 元')}`).join('<br/>')}${kind === 'premium' && point.premium === null ? '<br/>当日价格或净值缺失，不跨日期比较' : ''}`
    } },
    xAxis: { type: 'category', data: points.map(point => point.date), boundaryGap: false, axisLabel: { hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#383d49' } } },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: number => percent ? `${Number(number.toFixed(2))}%` : number.toFixed(3) }, splitLine: { lineStyle: { color: '#252832' } } },
    dataZoom: [{ type: 'inside', zoomOnMouseWheel: false, moveOnMouseWheel: false }, { type: 'slider', bottom: 10, height: 20, borderColor: '#383d49', textStyle: { color: '#959baa' } }],
    series: definitions.map(item => ({ name: item.name, type: 'line', data: points.map(point => point[item.key] === null ? null : point[item.key] * (percent ? 100 : 1)), connectNulls: false, showSymbol: points.length < 15, lineStyle: { width: 1.7, type: item.key === 'deviation' ? 'dashed' : 'solid' }, itemStyle: { color: item.color } })),
  }
}
