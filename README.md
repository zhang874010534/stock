# H30269 红利低波数据看板

Vue 3 + Vite + ECharts，部署到 Cloudflare Workers，日线保存在 D1。

网站：https://stock.zhangce0129.workers.dev/

## 每日同步

- 北京时间每天 **18:00** 执行 Worker Cron（UTC `0 10 * * *`）。
- 首次只请求最近 **30 个自然日**，当天不再回补。
- 之后先请求最近 **7 个自然日**，再补一个月历史；两次请求间隔 **30 秒**。
- 每天最多 **2 次上游请求**。按北京时间日期登记运行记录，重复或并发触发不会追加请求。失败也计入额度，当天不重试。
- 回补优先处理中断期间的缺口，再向前查询历史。`HISTORY_START_DATE` 默认指数基日 **2005-12-30**；每天一个月，补全多年历史需要数月。
- 行情和查询进度在同一事务提交，按 `(code, trade_date)` 更新，防止重复和失败后跳过历史。
- 短区间无数据可以是休市；整个历史月为空时保留进度并报告异常，不把它当成已补齐。
- 超时或失败后结束本轮；`429` 遵守 `Retry-After`（未提供有效值时等待24小时）；`403` 暂停，检查原因后人工恢复。
- 用户访问 `/api/h30269` 只读取 D1，没有公开的强制抓取接口。首页不会用模拟数据填充空行情。

数据源是中证网站使用的 `https://www.csindex.com.cn/csindex-home/perf/index-perf`，参数为 `indexCode`、`startDate`、`endDate`。未找到这个网站接口公开的调用频率承诺，少量请求也不能保证长期可用。当前只接入收盘点位，股息率、PE、PB 仍待接入。

参考：[接口实现](https://github.com/akfamily/akshare/blob/main/akshare/index/index_stock_zh_csindex.py)、[官方指数资料](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30269factsheet.pdf)、[Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

## 部署

`wrangler.jsonc` 已配置 `stock-data` 的 D1 绑定（`DB`）和定时任务。**第一次定时执行会自动创建所需表**，兼容在控制台创建的四字段 `index_daily`，无需清空现有数据。

保留 GitHub → Cloudflare 部署流程：构建命令 `npm run build`，部署命令 `npx wrangler deploy`。提交并推送代码后生效。部署不会立即抓取行情，下一次18:00执行首次同步；Cron 配置传播可能需要15分钟。

本机直接部署先完成 Cloudflare 登录：

```powershell
npx wrangler login
npm run deploy
```

## 本地验证

```powershell
npm install
npm test
npm run build
npm run dev:worker
```

访问 `http://localhost:8787`。本地 D1 与远程 D1 独立。如需前端热更新，再开一个终端执行 `npm run dev`，Vite 会将 `/api` 代理到8787端口。

测试使用内存 SQLite 和模拟上游响应，不访问中证。以下命令会真实访问中证，手动触发**本地**定时任务；仅在验证接通时运行一次，同一天重复触发会被运行记录拦住：

```powershell
Invoke-RestMethod 'http://localhost:8787/cdn-cgi/handler/scheduled'
```

线上结果可在 `/api/h30269` 或 Cloudflare 的 Cron / Worker 日志查看。

## D1 运行状态

`index_daily` 保存行情；`index_sync_coverage` 保存成功查询的日期范围（包含休市日）；`index_sync_runs` 保存每日额度和结果；`index_sync_state` 保存暂停原因、等待时间和最近同步时间。

在 D1 Console 查看最近任务：

```sql
SELECT * FROM index_sync_runs WHERE code = 'H30269' ORDER BY run_date DESC LIMIT 10;
SELECT * FROM index_sync_state WHERE code = 'H30269';
SELECT MIN(trade_date), MAX(trade_date), COUNT(*) FROM index_daily WHERE code = 'H30269';
```

403 后先检查来源是否允许访问。确认恢复条件后，执行以下语句解除暂停；保留日请求记录，下个定时任务再尝试：

```sql
UPDATE index_sync_state
SET paused = 0, retry_after = NULL, last_error = NULL
WHERE code = 'H30269';
```

停止同步可将 `wrangler.jsonc` 中 `SYNC_ENABLED` 改为 `"false"` 后部署，已有行情仍可查询。不要删除运行记录来反复触发抓取。
