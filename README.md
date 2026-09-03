# H30269 红利低波数据看板

Vue 3 + Vite + ECharts，部署到 Cloudflare Workers，按需读取东方财富日线。

网站：https://stock.zhangce0129.workers.dev/

## 数据获取

页面 → 同域 Worker API → 东方财富 → 图表。

- 打开页面默认请求近一年；切换时间范围时只请求对应区间，只有点击“全部”才请求完整可用历史。
- 为兼容休市日，有限区间向前多取10个自然日，图表按最新交易日截取展示。
- 点击“刷新行情”重新读取接口，不在后台轮询，也不定时抓取所有证券。
- Worker Cache API 短暂缓存60秒，同一实例内相同区间的并发请求合并；请求附加时间戳不会绕过缓存。
- 12秒超时，不自动重试。普通失败短缓存60秒；403冷却15分钟；429遵守有效的 Retry-After，缺省冷却5分钟。403/429冷却对该缓存节点的其他区间也生效。
- 缓存是各 Cloudflare 数据中心独立的临时结果，不是全站统一限流，也不保证上游不会限制请求。
- 没有 D1 读写、历史回补或每日 Cron，不会长期累计历史数据。

当前只接入 **H30269**，东方财富对应 `secid=2.H30269`。来源为 [东方财富红利低波页面](https://quote.eastmoney.com/zz/2.H30269.html) 使用的行情服务，日线接口：

```text
https://push2his.eastmoney.com/api/qt/stock/kline/get
```

请求使用 `klt=101`、`fqt=0`、受限的 `beg` / `end` 日期。服务端校验证券代码、市场、日期和点位；失败时显示错误，不用模拟数据填充。接口格式可参考 [AKShare 东方财富指数实现](https://github.com/akfamily/akshare/blob/main/akshare/index/index_zh_em.py)。网站接口可能变化，无可用性承诺。

这里的“实时获取”指**访问时获取最新可用日线**，不是逐笔行情推送。当天日线在盘中可能变化，时效由数据源决定。`updatedAt` 是本服务获取时间，`latest.date` 是最新交易日期；页面打开后不会自动刷新。股息率、PE、PB仍待接入。

## API 与扩展

```text
GET /api/history?symbol=H30269&range=1y
```

`range` 支持 `1m`、`3m`、`6m`、`1y`、`3y`、`5y`、`all`，默认 `1y`。旧入口 `/api/h30269?range=1y` 仍可用，共用缓存。无效代码或范围返回400，上游异常返回503并带 `Retry-After`。

成功结果包含 `code`、`name`、`source`、`interval`、`range`、`updatedAt`、`latest`，以及 `history: [{ date, close }]`。

未来扩展股票时，在 `worker/market-data.js` 的证券映射中确认并加入市场代码，再接入前端选择器。当前并未开放全部股票；股票复权、停牌、上市日期等口径需另外处理。按用户正在查看的证券请求，访问量扩大后再评估正式数据服务和统一限流。

## 部署

继续使用 GitHub → Cloudflare Workers：构建命令 `npm run build`，部署命令 `npx wrangler deploy`。提交并推送代码后，首次访问即可请求行情。

`wrangler.jsonc` 已移除 D1 绑定并显式配置 `triggers.crons: []`，用于清除旧的定时触发器。不要仅删除 `triggers` 字段，否则旧 Cron 可能保留；配置传播可能需要15分钟。参见 [Cloudflare Cron 文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。原有 `stock-data` 数据库不会被删除，项目不再使用它。

如需本机直接部署：

```powershell
npx wrangler login
npm run deploy
```

## 本地验证

```powershell
npm ci
npm test
npm run build
npm run dev:worker
```

访问 `http://localhost:8787`。前端热更新可另开终端执行 `npm run dev`，Vite将 `/api` 代理到8787端口。无需D1配置或建表。

自动测试使用模拟上游响应，不访问东方财富，覆盖日线解析、区间查询、缓存、并发合并、冷却、超时及图表。手动访问本地或线上页面会真实请求东方财富。
