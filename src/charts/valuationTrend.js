export function valuationTrendOption(stats, metric, expanded = false) {
  const label = metric === 'pe' ? '市盈率 PE' : '市净率 PB'
  return {
    animation: false,
    textStyle: { color: '#959baa', fontFamily: 'sans-serif' },
    grid: { left: 42, right: 12, top: 18, bottom: expanded ? 82 : 32 },
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' }, valueFormatter: value => `${Number(value).toFixed(2)} 倍` },
    xAxis: { type: 'category', data: stats.points.map(p => p.date), boundaryGap: false, axisLine: { lineStyle: { color: '#383d49' } }, axisTick: { show: false }, axisLabel: { hideOverlap: true, formatter: value => expanded ? value : value.slice(5) } },
    yAxis: { type: 'value', scale: true, splitNumber: 4, axisLabel: { formatter: value => Number(value.toFixed(2)).toString() }, splitLine: { lineStyle: { color: '#252832' } } },
    dataZoom: expanded ? [{ type: 'inside', xAxisIndex: 0 }, { type: 'slider', xAxisIndex: 0, bottom: 14, height: 26, borderColor: '#383d49', fillerColor: '#5378c433', textStyle: { color: '#959baa' } }] : [],
    series: [{
      name: label, type: 'line', data: stats.points.map(p => p.value), smooth: false,
      showSymbol: stats.count < 20, symbolSize: 5, itemStyle: { color: '#709bff' }, lineStyle: { width: 1.5 },
      markLine: stats.low === null ? undefined : { silent: true, symbol: 'none', label: { show: false }, data: [
        { name: '70%分位值', yAxis: stats.high, lineStyle: { color: '#ef697c', type: 'dashed' } },
        { name: '30%分位值', yAxis: stats.low, lineStyle: { color: '#34c79a', type: 'dashed' } },
      ] },
    }],
  }
}
