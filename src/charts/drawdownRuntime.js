import { init, use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent, MarkPointComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent, MarkPointComponent, CanvasRenderer])

export function initDrawdown(container, options = {}) {
  return init(container, null, { renderer: 'canvas', ...options })
}
