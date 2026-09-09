import { toCandlestickData } from '../../utils/kline.js'
import { KLINE_COLORS } from './config.js'

export function createLineSeries({ id, name, color, data }, axisIndex = 0) {
  return {
    id,
    name,
    type: 'line',
    xAxisIndex: axisIndex,
    yAxisIndex: axisIndex,
    data,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: 1.2, color },
    itemStyle: { color },
    emphasis: { disabled: true },
  }
}

export function createKlineSeries(history, movingAverages, mainIndicators = [], subIndicator, chartType = 'candlestick') {
  // 兼容旧调用签名 createKlineSeries(history, movingAverages, subIndicator)。
  if (!Array.isArray(mainIndicators)) {
    subIndicator = mainIndicators
    mainIndicators = []
  }
  return [
    chartType === 'line' ? {
      ...createLineSeries({ id: 'index-close', name: '收盘价', color: '#e7c65b', data: history.map(point => point.close) }),
      lineStyle: { width: 1.8, color: '#e7c65b' },
      smooth: false,
    } : {
      id: 'index-kline',
      name: '指数 K 线',
      type: 'candlestick',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: toCandlestickData(history),
      barMaxWidth: 18,
      itemStyle: {
        color: KLINE_COLORS.background,
        color0: KLINE_COLORS.down,
        borderColor: KLINE_COLORS.up,
        borderColor0: KLINE_COLORS.down,
        borderColorDoji: KLINE_COLORS.up,
      },
    },
    {
      id: 'index-volume',
      name: '成交量',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      barMaxWidth: 18,
      data: history.map((point) => ({
        value: Number.isFinite(point.volume) ? point.volume : null,
        itemStyle: { color: point.close >= point.open ? KLINE_COLORS.up : KLINE_COLORS.down },
      })),
    },
    ...movingAverages.filter((item) => item.enabled).map((item) => createLineSeries({
      ...item, id: `ma-${item.period}`, name: `MA${item.period}`,
    })),
    ...mainIndicators.flatMap((indicator) => indicator.createSeries(0)),
    ...subIndicator.createSeries(2),
  ]
}
