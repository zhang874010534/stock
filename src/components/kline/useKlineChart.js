import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getRangeWindow, getZoomWindow } from '../../utils/indexHistory.js'
import { getDefaultKlineWindow } from '../../utils/kline.js'
import { getKeyboardKlineTarget } from '../../utils/klineKeyboard.js'
import { clampKlineViewport, getKlineTimelineLength } from '../../utils/klineViewport.js'

export function useKlineChart({ element, history, period, movingAverages, mainIndicators, subIndicator, chartType, compact, pricePrecision }) {
  const loading = ref(true)
  const error = ref('')
  const range = ref('recent')
  const hoveredIndex = ref(null)
  const quoteSide = ref('left')
  const activeIndex = computed(() => hoveredIndex.value ?? history.value.length - 1)
  const isHovering = computed(() => hoveredIndex.value !== null)
  const visibleWindow = ref({ startIndex: 0, endIndex: 0 })
  const height = ref(360)
  const chartRevision = ref(0)
  let runtime
  let chart
  let observer
  let resizeFrame
  let disposed = false

  function resetHover() {
    hoveredIndex.value = null
    quoteSide.value = 'left'
  }

  function handlePointer(event) {
    const axis = event.axesInfo?.find((item) => item.axisDim === 'x')
    const index = typeof axis?.value === 'number' ? axis.value : history.value.findIndex((point) => point.date === axis?.value)
    hoveredIndex.value = Number.isInteger(index) && history.value[index] ? index : null
  }

  function handleMouseMove(event) {
    quoteSide.value = event.offsetX > element.value.clientWidth / 2 ? 'left' : 'right'
    if (!chart.containPixel({ gridIndex: compact.value ? [0] : [0, 1, 2] }, [event.offsetX, event.offsetY])) resetHover()
  }

  function handleZoom() {
    const zoom = chart.getOption().dataZoom[0]
    const requested = getZoomWindow(getKlineTimelineLength(history.value.length), zoom.start, zoom.end)
    visibleWindow.value = clampKlineViewport(history.value.length, requested)
    if (requested.startIndex !== visibleWindow.value.startIndex) {
      chart.dispatchAction({ type: 'dataZoom', startValue: visibleWindow.value.startIndex, endValue: visibleWindow.value.endIndex })
    }
    range.value = 'custom'
  }

  function presetWindow(key) {
    return key === 'recent' ? getDefaultKlineWindow(history.value, period.value) : getRangeWindow(history.value, key)
  }

  function selectRange(key) {
    const window = presetWindow(key)
    chart?.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: window.startIndex, endValue: window.endIndex })
    range.value = key
    visibleWindow.value = window
    resetHover()
  }

  function handleKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || event.defaultPrevented || loading.value || error.value || !chart || !history.value.length) return
    event.preventDefault()
    event.stopPropagation()
    const target = getKeyboardKlineTarget(history.value.length, activeIndex.value, visibleWindow.value, event.key === 'ArrowLeft' ? -1 : 1)
    if (target.window.startIndex !== visibleWindow.value.startIndex || target.window.endIndex !== visibleWindow.value.endIndex) {
      zoomToWindow(target.window.startIndex, target.window.endIndex)
    }
    const x = chart.convertToPixel({ xAxisIndex: 0 }, target.index)
    const y = chart.convertToPixel({ yAxisIndex: 0 }, history.value[target.index].close)
    chart.dispatchAction({ type: 'updateAxisPointer', x, y })
    hoveredIndex.value = target.index
    quoteSide.value = x > element.value.clientWidth / 2 ? 'left' : 'right'
  }

  function indexAtPixel(x) {
    if (!chart || !history.value.length) return null
    const index = chart.convertFromPixel({ xAxisIndex: 0 }, x)
    return Number.isFinite(index) ? Math.max(visibleWindow.value.startIndex, Math.min(history.value.length - 1, visibleWindow.value.endIndex, Math.round(index))) : null
  }

  function pointAtPixel(x, y) {
    const index = indexAtPixel(x)
    const price = chart?.convertFromPixel({ yAxisIndex: 0 }, y)
    return index !== null && history.value[index] && Number.isFinite(price)
      ? { date: history.value[index].date, price } : null
  }

  function pointToPixel(point) {
    if (!chart) return null
    const index = history.value.findIndex(bar => bar.date === point.date)
    if (index < 0) return null
    const x = chart.convertToPixel({ xAxisIndex: 0 }, index)
    const y = chart.convertToPixel({ yAxisIndex: 0 }, point.price)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  function priceToPixel(price) {
    if (!chart) return null
    const y = chart.convertToPixel({ yAxisIndex: 0 }, price)
    return Number.isFinite(y) ? y : null
  }

  function zoomToWindow(startIndex, endIndex) {
    chart?.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: startIndex, endValue: endIndex })
    visibleWindow.value = { startIndex, endIndex }
    range.value = 'custom'
    resetHover()
  }

  function renderChart() {
    if (!runtime || !element.value?.clientWidth || disposed) return
    resetHover()
    if (!history.value.length) {
      chart?.clear()
      return
    }
    try {
      if (!chart) {
        chart = runtime.initIndexTrend(element.value)
        chart.on('finished', () => { chartRevision.value++ })
        chart.on('datazoom', handleZoom)
        chart.on('updateAxisPointer', handlePointer)
        chart.getZr().on('globalout', resetHover)
        chart.getZr().on('mousemove', handleMouseMove)
      }
      height.value = element.value.clientHeight
      visibleWindow.value = presetWindow(range.value === 'custom' ? 'recent' : range.value)
      chart.setOption(runtime.createIndexTrendOption(history.value, visibleWindow.value, {
        height: height.value,
        compact: compact.value,
        pricePrecision: pricePrecision.value,
        chartType: chartType.value,
        movingAverages: movingAverages.value,
        mainIndicators: mainIndicators.value,
        subIndicator: subIndicator.value,
      }), { notMerge: true })
      error.value = ''
    } catch {
      error.value = '图表绘制失败，请重试'
    }
  }

  function resize() {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      if (disposed || !element.value?.clientWidth) return
      height.value = element.value.clientHeight
      if (chart) {
        chart.resize()
        if (history.value.length) chart.setOption({ grid: runtime.createKlineGrids(height.value, subIndicator.value.key, compact.value) })
      } else if (!loading.value && !error.value) renderChart()
    })
  }

  async function load() {
    loading.value = true
    error.value = ''
    try {
      runtime = await import('../../charts/indexTrend.js')
      if (!disposed) renderChart()
    } catch {
      if (!disposed) error.value = '图表加载失败，请重试'
    } finally {
      if (!disposed) loading.value = false
    }
  }

  watch([history, period], () => {
    range.value = 'recent'
    renderChart()
  }, { flush: 'post' })

  // 切换预览/放大视图时重建坐标轴，保留用户当前查看的行情区间。
  watch([movingAverages, mainIndicators, subIndicator, chartType, compact], () => {
    if (!chart || !history.value.length) return
    height.value = element.value.clientHeight
    chart.resize()
    chart.setOption(runtime.createIndexTrendOption(history.value, visibleWindow.value, {
      height: height.value,
      compact: compact.value,
      pricePrecision: pricePrecision.value,
      chartType: chartType.value,
      movingAverages: movingAverages.value,
      mainIndicators: mainIndicators.value,
      subIndicator: subIndicator.value,
    }), { notMerge: true })
  }, { flush: 'post' })

  onMounted(() => {
    observer = new ResizeObserver(resize)
    observer.observe(element.value)
    load()
  })

  onBeforeUnmount(() => {
    disposed = true
    observer?.disconnect()
    cancelAnimationFrame(resizeFrame)
    chart?.dispose()
  })

  return { loading, error, range, activeIndex, isHovering, visibleWindow, height, quoteSide, selectRange, resetHover, resize, load, indexAtPixel, zoomToWindow, handleKeydown, chartRevision, pointAtPixel, pointToPixel, priceToPixel }
}
