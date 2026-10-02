export function investmentSimulatorOption(stats) {
  const dates = stats.series[0].points.map(point => point.date)
  return {
    animation: false, textStyle: { color: '#959baa', fontFamily: 'sans-serif' },
    legend: { top: 5, textStyle: { color: '#aebcd1', fontSize: 10 }, itemWidth: 15, itemHeight: 8 },
    grid: { left: 68, right: 18, top: 62, bottom: 72 },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' },
      formatter(params) {
        const i = (Array.isArray(params) ? params[0] : params)?.dataIndex
        return dates[i] ? `${dates[i]}<br/>${stats.series.map(item => `${item.name}：${item.points[i].assets.toFixed(2)} 元`).join('<br/>')}<br/>累计投入：${stats.series[0].points[i].contributed.toFixed(2)} 元<br/>含持仓、剩余现金${stats.config.basis !== 'price' ? '和分红应收' : ''}` : ''
      } },
    xAxis: { type: 'category', data: dates, boundaryGap: false, axisTick: { show: false }, axisLabel: { hideOverlap: true }, axisLine: { lineStyle: { color: '#383d49' } } },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: value => Math.abs(value) >= 10000 ? `${Number((value / 10000).toFixed(2))}万` : value.toFixed(0) }, splitLine: { lineStyle: { color: '#252832' } } },
    dataZoom: [{ type: 'inside', zoomOnMouseWheel: false, moveOnMouseWheel: false }, { type: 'slider', bottom: 12, height: 22, borderColor: '#383d49', textStyle: { color: '#959baa' } }],
    series: [...stats.series.map(item => ({ name: item.name, type: 'line', data: item.points.map(point => point.assets), showSymbol: dates.length < 15, symbolSize: 4, lineStyle: { width: 1.7 }, itemStyle: { color: item.color } })),
      { name: '累计投入资金', type: 'line', data: stats.series[0].points.map(point => point.contributed), showSymbol: false, lineStyle: { type: 'dashed', width: 1 }, itemStyle: { color: '#74839a' } }],
  }
}
