# 首页指数 K 线

首页继续通过 `src/api/h30269.js` 读取 `public/data/h30269.json`，将已加载的完整日线传给 `IndexChart.vue`。周期、主图指标、副图指标、参数和时间范围均在前端切换，不额外请求数据。

## 文件职责

- `src/views/Home.vue`：保留行情加载、刷新、错误状态及其他首页模块。
- `src/components/IndexChart.vue`：组合工具栏、当前行情、主/副图指标读数及图表状态。
- `src/components/kline/KLineToolbar.vue`：周期、日期范围、MA、BOLL、副图选择和参数入口。
- `src/components/kline/KLineIndicatorSettings.vue`：BOLL 与当前副图指标的参数编辑、校验和恢复默认值。
- `src/components/kline/KLineQuote.vue`：鼠标所在 K 线的 OHLC、涨跌、成交量、MA 和 BOLL 数值。
- `src/components/kline/useKlineChart.js`：单一 ECharts 实例、懒加载、缩放、十字光标、指标热更新和 ResizeObserver。
- `src/components/kline/useKlineFullscreen.js`：移动同一图表到全屏容器、ESC、焦点与滚动恢复。
- `src/utils/kline.js`：行情校验、周/月/季聚合、默认视窗和行情读数。
- `src/utils/indicators.js`：MA、KDJ、MACD、RSI、BOLL 的独立纯函数计算。
- `src/charts/indexTrend.js`：ECharts 注册、三个坐标系、十字光标、dataZoom 与副图坐标轴配置。
- `src/charts/kline/config.js`：市场配色、MA 默认项及各指标默认参数。
- `src/charts/kline/series.js`：K 线、成交量、均线、主图指标和副图指标的 series 组合。
- `src/charts/kline/mainIndicators.js`：主图指标注册，目前提供 BOLL。
- `src/charts/kline/subIndicators.js`：副图指标注册，目前提供 KDJ、MACD、RSI。

## 指标与参数

- MA：MA5/10/20 默认关闭，MA30/60 默认开启；使用当前周期最近 N 根收盘价简单平均，不足 N 根显示“—”。
- BOLL：默认关闭，可在主图独立开关；默认 `BOLL(20,2)`，中轨为 20 根简单均线，上下轨为中轨 ± 2 倍总体标准差。
- KDJ：默认 `KDJ(9,3,3)`；K、D 初值 50，J 不截断到 0–100。
- MACD：默认 `MACD(12,26,9)`；DIF 为快慢 EMA 差，DEA 为 DIF 的信号 EMA，MACD 柱使用 `2 × (DIF - DEA)`，正柱红、负柱青。
- RSI：默认 `RSI(6,12,24)`；使用 Wilder 平滑，三个周期必须满足短 < 中 < 长，副图纵轴固定 0–100。
- “参数”入口可编辑当前副图指标与 BOLL 参数。输入先在草稿中修改，点击“应用”后一次性生效；非法范围、MACD 快线不小于慢线、RSI 周期顺序错误都会阻止应用。
- 参数、MA/BOLL 开关在日/周/月/季切换时保留；指标始终针对当前聚合周期重新计算，而不是把日线指标结果再次聚合。

## 计算与交互口径

- 周线按周一至周日，月线按自然月，季线按 1–3、4–6、7–9、10–12 月。每个周期使用首根开盘、末根收盘、最高价、最低价和累计成交量。
- 历史回补未完成的首个周期、尚未结束的当前周期，仅包含已同步交易日。原始 JSON 不变，缺失的成交量也不会补成零。
- 先按完整已同步历史聚合，再计算指标，最后用 dataZoom 选择可见范围。范围按钮只调整视窗，不截断指标计算历史。
- “最近”为默认视窗：日线 150 根、周线 100 根、月线 60 根、季线 40 根；不足时显示已有数据。
- 鼠标移动到主图、成交量、副图时三图十字光标同步；离开图表后读数恢复最新一根。
- 指标切换和参数应用只替换 ECharts 指标 series，并同步必要的副图纵轴配置，尽量保留当前缩放与拖动位置。

## 手动验收

1. 执行 `npm run dev`，确认首页行情、K 线和原有模块正常。
2. 日/周/月/季依次切换，确认 MA、BOLL、KDJ/MACD/RSI 会按当前周期重新计算，参数和开关状态不会被重置。
3. 打开 BOLL，确认主图出现 BOLL/UPPER/LOWER 三条线，顶部读数同步；关闭后只移除 BOLL，不影响 MA 和缩放范围。
4. 副图依次切换 KDJ、MACD、RSI。MACD 应有 DIF、DEA 两条线和红/青柱；RSI 应有三条线且纵轴为 0–100。
5. 打开“参数”：分别修改 KDJ、MACD、RSI、BOLL，点击应用后标题、读数和图形即时刷新；测试“默认值”恢复。
6. 测试非法参数：MACD 快线 >= 慢线、RSI N1/N2/N3 顺序错误、超出输入范围，均应显示错误且不更新图表。
7. 在主图、副图滚轮缩放、左右拖动和拖动 slider，确认三图时间轴同步；切指标/改参数后当前缩放位置保持。
8. 点击“放大”，确认所有新控件、参数菜单、ESC 退出和窗口 resize 正常。

## 检查

建议完整环境运行 `npm test`、`npm run build`，部署前再执行 `npx wrangler deploy --dry-run`。项目未配置 ESLint/Prettier。
