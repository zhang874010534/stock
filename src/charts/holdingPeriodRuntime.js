import { init, use } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, BarChart, GridComponent, TooltipComponent, DataZoomComponent, TitleComponent, CanvasRenderer])
export function initHoldingPeriod(container, options = {}) { return init(container, null, { renderer: 'canvas', ...options }) }
