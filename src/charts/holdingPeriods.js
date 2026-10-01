export function holdingPeriodOption(series) {
  return {
    animation: false, textStyle: { color: '#959baa', fontFamily: 'sans-serif' },
    title: [{ text: `买入日期与持有 ${series.years} 年收益`, top: 0, left: 10 }, { text: '完整样本的收益分布', top: 305, left: 10 }].map(item => ({ ...item, textStyle: { color: '#b8ceec', fontSize: 12, fontWeight: 400 } })),
    grid: [{ left: 55, right: 18, top: 38, height: 210 }, { left: 55, right: 18, top: 347, height: 150 }],
    tooltip: { trigger: 'axis', confine: true, backgroundColor: '#20232c', borderColor: '#383d49', textStyle: { color: '#e1e8f3' }, formatter(params) {
      const item = Array.isArray(params) ? params[0] : params
      if (!item) return ''
      if (item.seriesId === 'holding-distribution') {
        const bin = series.bins[item.dataIndex]
        return bin ? `${bin.description}<br/>${bin.count} 个完整样本 · ${(bin.count / series.count * 100).toFixed(2)}%` : ''
      }
      const point = series.points[item.dataIndex]
      return point ? `买入 ${point.buyDate}<br/>目标周年 ${point.targetDate}<br/>到期 ${point.exitDate}<br/>${point.status === 'complete' ? `持有收益 ${(point.returnRate * 100).toFixed(2)}%` : '区间行情缺失，未纳入统计'}` : ''
    } },
    xAxis: [
      { type: 'category', data: series.points.map(point => point.buyDate), boundaryGap: false, axisLabel: { hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#383d49' } } },
      { gridIndex: 1, type: 'category', data: series.bins.map(bin => bin.label), axisTick: { show: false }, axisLabel: { fontSize: 9, rotate: 35, hideOverlap: true }, axisLine: { lineStyle: { color: '#383d49' } } },
    ],
    yAxis: [
      { type: 'value', scale: true, axisLabel: { formatter: value => `${Number(value.toFixed(1))}%` }, splitLine: { lineStyle: { color: '#252832' } } },
      { gridIndex: 1, type: 'value', name: '样本数', minInterval: 1, nameTextStyle: { fontSize: 10 }, splitLine: { lineStyle: { color: '#252832' } } },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: false }, { type: 'slider', xAxisIndex: 0, top: 272, height: 18, showDetail: false, borderColor: '#383d49', textStyle: { color: '#959baa' } }],
    series: [
      { id: 'holding-returns', name: '持有期收益', type: 'line', data: series.points.map(point => point.returnRate === null ? null : point.returnRate * 100), showSymbol: series.points.length < 15, connectNulls: false, itemStyle: { color: '#69a9ff' }, lineStyle: { width: 1.6 } },
      { id: 'holding-zero', name: '零收益参考', type: 'line', data: series.points.map(() => 0), showSymbol: false, silent: true, itemStyle: { color: '#73859e' }, lineStyle: { width: 1, type: 'dashed' } },
      { id: 'holding-distribution', name: '完整样本数', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 48,
        data: series.bins.map((bin, i) => ({ value: bin.count, itemStyle: { color: i < 3 ? '#63d0b0' : i === 3 ? '#73859e' : '#e88c8c' } })), label: { show: true, position: 'top', color: '#aebcd1', fontSize: 10 } },
    ],
  }
}
