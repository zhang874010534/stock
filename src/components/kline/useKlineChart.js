import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getRangeWindow, getZoomWindow } from '../../utils/indexHistory.js'
import { getDefaultKlineWindow } from '../../utils/kline.js'
import { createKlineSeries } from '../../charts/kline/series.js'

export function useKlineChart({ element, history, period, movingAverages, mainIndicators, subIndicator }) {
  const loading = ref(true)
  const error = ref('')
  const range = ref('recent')
  const hoveredIndex = ref(null)
  const quoteSide = ref('left')
  const activeIndex = computed(() => hoveredIndex.value ?? history.value.length - 1)
  const isHovering = computed(() => hoveredIndex.value !== null)
  const visibleWindow = ref({ startIndex: 0, endIndex: 0 })
  const height = ref(360)
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
    if (!chart.containPixel({ gridIndex: [0, 1, 2] }, [event.offsetX, event.offsetY])) resetHover()
  }

  function handleZoom() {
    const zoom = chart.getOption().dataZoom[0]
    visibleWindow.value = getZoomWindow(history.value.length, zoom.start, zoom.end)
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

  function indexAtPixel(x) {
    if (!chart || !history.value.length) return null
    const index = chart.convertFromPixel({ xAxisIndex: 0 }, x)
    return Number.isFinite(index) ? Math.max(visibleWindow.value.startIndex, Math.min(visibleWindow.value.endIndex, Math.round(index))) : null
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
        chart.on('datazoom', handleZoom)
        chart.on('updateAxisPointer', handlePointer)
        chart.getZr().on('globalout', resetHover)
        chart.getZr().on('mousemove', handleMouseMove)
      }
      height.value = element.value.clientHeight
      visibleWindow.value = presetWindow(range.value === 'custom' ? 'recent' : range.value)
      chart.setOption(runtime.createIndexTrendOption(history.value, visibleWindow.value, {
        height: height.value,
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
        if (history.value.length) chart.setOption({ grid: runtime.createKlineGrids(height.value, subIndicator.value.key) })
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

  // 只替换指标 series，保留用户缩放、拖动与当前行情位置。
  watch([movingAverages, mainIndicators, subIndicator], () => {
    if (!chart || !history.value.length) return
    chart.setOption({
      grid: runtime.createKlineGrids(height.value, subIndicator.value.key),
      yAxis: [
        {},
        {},
        {
          min: subIndicator.value.axis?.min ?? null,
          max: subIndicator.value.axis?.max ?? null,
          splitNumber: subIndicator.value.axis?.splitNumber ?? 2,
          scale: !(Number.isFinite(subIndicator.value.axis?.min) && Number.isFinite(subIndicator.value.axis?.max)),
        },
      ],
      series: createKlineSeries(history.value, movingAverages.value, mainIndicators.value, subIndicator.value),
    }, { replaceMerge: ['series'] })
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

  return { loading, error, range, activeIndex, isHovering, visibleWindow, height, quoteSide, selectRange, resetHover, resize, load, indexAtPixel, zoomToWindow }
}
