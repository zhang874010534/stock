# H30269 红利低波数据看板 · AKShare 版

Vue 3 + Vite + ECharts；Cloudflare Workers 提供页面和同域 API，独立 Python 服务通过 **AKShare** 按需获取行情，成功结果短缓存 **60 秒**。

```text
浏览器 → Cloudflare Worker → Python / AKShare → 中证指数
                                │
                                └─ 内存缓存 60 秒
```

**这一版需要单独部署 Python 服务。只在 Cloudflare 执行 npm run build 不会运行 AKShare。** AKShare 当前使用同步 requests；Cloudflare Python Workers 的网络库支持有相应限制，因此使用普通 CPython 服务。参见 [Cloudflare Python 包支持说明](https://developers.cloudflare.com/workers/languages/python/packages/)。

## 数据与缓存

- 实际调用 `ak.stock_zh_index_hist_csindex(symbol="H30269", start_date=..., end_date=...)`，由 AKShare 请求和解析中证指数日线。当前接入 H30269 的日期和收盘点位，AKShare 锁定 `1.18.94`。详见 [AKShare 中证指数文档](https://akshare.akfamily.xyz/data/index/index.html) 与 [函数源码](https://github.com/akfamily/akshare/blob/main/akshare/index/index_stock_zh_csindex.py)。AKShare 是采集工具，上游仍是中证指数，不保证数据源永远可用。
- 默认只取近一年，切换范围才查询对应区间；有限区间向前多取 10 个自然日以适应休市，图表按最新观测日期裁切。只有点击“全部”才请求完整可用历史。
- 缓存按“证券代码 + 时间范围”区分。成功获取后保留 60 秒，读取不会续期；手动刷新或附加时间戳也不能绕过缓存。到期后，下次访问才重新查询。
- 相同区间的并发请求共用一次查询。一个 Python 实例同时最多查询一个区间，其他尚未缓存的区间返回“正在获取其他行情”，防止并发抓取。缓存最多保留 32 项。
- 普通失败冷却 60 秒；HTTP 403 冷却 15 分钟；HTTP 429 遵守有效的 `Retry-After`，缺省 5 分钟。冷却期间暂停其他区间的新查询，已有有效缓存仍可读。没有自动重试。
- 单次查询在独立子进程内运行，25 秒后终止；子进程内为 AKShare 的 requests 补充连接 5 秒、读取 12 秒超时与 HTTP 状态检查。
- 缓存和冷却状态只在当前 Python 实例内存中，重启即清空。部署命令固定 `--workers 1`；若扩成多个实例，需要额外协调缓存和限流。
- Cloudflare 保留缓存剩余时间，不重新延长 60 秒。前端无后台轮询；没有 D1 读写、历史回补、定时抓取或数据库服务。

这里的“实时获取”是访问时获取**最新可用日线**，不是逐笔或秒级行情。`updatedAt` 是本服务取数时间，`latest.date` 是最新交易日期。股息率、PE、PB及历史分位仍待接入；失败时显示错误，不使用模拟数据填充。模拟数据文件仅用于原有图表测试。

## 本地运行

需要 Node.js、Python 3.11–3.13 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)。在项目根目录安装依赖：

```powershell
npm ci
uv sync --project backend --frozen
```

终端一运行 `npm run dev:api`，终端二运行 `npm run dev`，然后打开 Vite 输出的网址。Vite 将 `/api` 转发到 `http://127.0.0.1:8000`。本地只监听回环地址，默认不设置服务密钥。

如需连同 Cloudflare Worker 一起验证，在 Python 保持运行时执行：

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run build
npm run dev:worker
```

打开 `http://localhost:8787`。已有 `.dev.vars` 时请修改现有文件，不要覆盖其中的其他配置。

不使用 uv 时，也可创建 Python 虚拟环境，执行 `pip install --require-hashes -r backend/requirements.txt`，再从项目根目录运行 `python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`。这只安装运行依赖，不含测试依赖。

## 免费部署：Render + Cloudflare

仓库根目录的 `render.yaml` 只声明一个 **Free Python Web Service**，不创建数据库或磁盘。当前试用分支为 `codex/akshare-on-demand`。

### 1. 部署 Python 服务

在 [Render 控制台](https://dashboard.render.com/) 创建 Blueprint，连接此 GitHub 仓库，选择 `codex/akshare-on-demand` 分支，读取根目录 `render.yaml`。检查实例类型为 **Free** 后部署。配置依据 [Render Blueprint 文档](https://render.com/docs/blueprint-spec)。

如果手动创建 Web Service，填写：

| 设置 | 值 |
| --- | --- |
| Branch | `codex/akshare-on-demand` |
| Language / Runtime | Python |
| Root Directory | `backend` |
| Build Command | `pip install --require-hashes -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1` |
| Instance Type | Free |
| Health Check Path | `/health` |
| 环境变量 `PYTHON_VERSION` | `3.13.5` |
| 环境变量 `AKSHARE_API_TOKEN` | 随机服务密钥；使用 Blueprint 时自动生成 |

部署成功后，保存 Render 分配的 HTTPS 服务地址。访问该地址的 `/health` 应返回 `{"status":"ok","provider":"AKShare"}`；这个检查只验证服务运行，**不会请求行情**。行情是否可取还需要完成下一步后检查。

### 2. 配置 Cloudflare Worker

在现有 `stock` Worker 的 **Settings → Variables and Secrets** 中添加运行时配置：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `AKSHARE_API_URL` | 文本变量 | Render 实际分配的 HTTPS 服务地址，不加 `/api/history` |
| `AKSHARE_API_TOKEN` | Secret | 与 Render 环境变量中完全相同的值 |

这些是 Worker 运行时配置，不是前端 `VITE_*` 变量，也不是只在 Build 中设置的变量。密钥只在两端的服务配置中保存。`wrangler.jsonc` 的 `keep_vars: true` 会保留控制台设置的文本变量。

然后将 Cloudflare 的部署分支切换到此版本，或者在 Python 已就绪后将此分支合并到 `main`。构建命令仍是 `npm run build`，部署命令仍是 `npx wrangler deploy`。若以后统一使用 `main`，也要将 `render.yaml` 的 `branch` 同步改为 `main`。

### 3. 验证取数

访问站点的 `/api/history?symbol=H30269&range=1m`。成功响应应包含 `provider: "AKShare"`、`source: "中证指数"` 和非空 `history`；随后打开首页查看图表。60 秒内重复访问同一区间，`updatedAt` 应保持一致。

未配置 Python 地址时，Worker 会返回 `backend_not_configured`；两端密钥不一致会返回 `backend_auth_failed`；上游拒绝、限流或超时会如实返回错误。**本地取数成功不等于 Render 出口一定能访问数据源，部署后须实际检查一次。**

Render Free 闲置 15 分钟会休眠，下一次启动约需一分钟；启动页面可能使首次行情请求失败，稍后手动重试即可。页面预留了较长等待时间。Free 工作区每月共享 750 实例小时，另有流量和构建额度；额度外可能暂停服务，有付款方式时部分超额可能收费。按免费方案使用并关注额度，详见 [Render 免费服务限制](https://render.com/docs/free)。

原有 D1 数据库不会被删除，本项目不再绑定或使用它。`triggers.crons: []` 用于清除旧定时器。

## H30269 / 512890 数据更新

GitHub Actions 在每个工作日北京时间 16:30（UTC 08:30）运行 `npm run data:update`，更新
`public/data/h30269.json` 和 `public/data/512890.json`。两只证券分别刷新最近 30 个自然日、回补一个 90 天窗口，并保存独立游标。数据有变化时只提交行情 JSON，commit 信息为
`chore(data): update market data`；没有变化时不产生 commit。

执行时先分别更新并保存两个标的的近期行情，再回补历史，阶段之间间隔 3 秒。近期行情失败会保留旧数据、跳过该标的本轮回补，并将任务标记失败；其他标的继续处理。仅历史回补请求失败时给出 Actions 警告，保留回补游标，下次继续，不影响已保存的近期行情。文件读写或校验异常仍标记失败。网络失败日志附带可用的底层错误码（例如 `ECONNRESET`、`ENOTFOUND`），用于排查连接或 DNS 问题。失败任务仍会尝试提交已成功更新的数据。

需要手动执行时，进入 GitHub **Actions → Update H30269 and 512890 → Run workflow**。GitHub Actions
只负责数据更新与提交；Cloudflare 仍由原有 GitHub 集成在检测到新 commit 后负责 Build 和 Deploy。

## API 与扩展

### 股息率与十年期国债收益率

股息率卡片读取中证指数 H30269 的 `D/P1`（总股本口径，百分数），下方展示中债国债到期收益率曲线的 10 年期限值。512890 页面明确标为“标的指数股息率”，不代表 ETF 自身的现金分红收益率。两项分别显示数据日期和官方来源，不计算日期不一致的利差。

独立工作流 `Update dividend and treasury yields` 在工作日北京时间 18:15 更新（中债官网注明日终发布时间为 17:30），也支持手动运行。依赖仅为 Python 和读取中证官方 XLS 文件的 `xlrd`，没有引入 AKShare，也不改变东方财富 K 线流程。各指标独立保存：一项失败不影响另一项；失败或上游日期倒退时保留旧文件，不把旧数据标成当天数据。股票和指标工作流共享提交锁，避免互相同时推送。

本地更新：

```powershell
python -m pip install -r scripts/requirements-indicators.txt
python scripts/fetch-indicators.py
```

输出为 `public/data/dividend-h30269.json` 与 `public/data/china-bond-10y.json`。GitHub Actions 提交成功后随网站部署生效。

```text
GET /api/history?symbol=H30269&range=1y
GET /api/h30269?range=1y
GET /health                         # 仅 Python 服务
```

`range` 支持 `1m`、`3m`、`6m`、`1y`、`3y`、`5y`、`all`，默认 `1y`。成功结果包含 `code`、`name`、`provider`、`source`、`interval`、`range`、`updatedAt`、`latest`，以及 `history: [{ date, close }]`。无效查询返回 400；行情不可用返回 503 和 `Retry-After`。Python 直接访问需要 Bearer 密钥（若设置了 `AKSHARE_API_TOKEN`）。

扩展全部股票时，需要在 `backend/app/market.py` 接入对应的 AKShare 股票函数，定义代码、上市日期、复权等口径，并同步 Worker 的白名单和前端选择器。当前仅 H30269 可查询，不会因部署而自动抓取所有股票。

## 验证与维护

```powershell
npm test
npm run test:api
npm run build
npx wrangler deploy --dry-run
```

自动测试不访问行情源，覆盖图表、API 代理、鉴权、日线校验、缓存过期、并发合并、冷却和查询进程超时。手动请求才会调用 AKShare 获取真实数据。

升级 Python 依赖后更新锁定文件及 Render 使用的导出文件：

```powershell
uv lock --project backend
uv export --project backend --no-dev --frozen --format requirements-txt --output-file backend/requirements.txt --quiet
```

`backend/.env.example` 仅说明可选环境变量，服务不会自动读取该文件；线上通过 Render 设置，本地需要时在启动服务的终端中设置。


## 512890 波段信号

顶部证券选择可切换 H30269 和 512890（华泰柏瑞红利低波ETF）。512890 使用东方财富
`1.512890` 未复权日线，保留 OHLC、成交量、成交额和换手率（百分数）。周、月、季线
聚合价格与成交数据，换手率为该周期每日换手率之和；缺少任一日换手率时不计算该周期短买点。
现有 H30269 的价格数据不变。两只证券每天北京时间 16:30（周一至周五）由同一工作流更新。
一只更新失败时仍尝试另一只；保存成功的数据后，工作流以失败状态提示未完成的更新。

副图下拉框的“波段信号”仅对 512890 开放；H30269 显示“指标不可用”。副图包含趋势K线、
MA5、信号色柱与标记，悬停对应日期时下方列出该根K线全部信号。标签自动避让，缩放与主图联动。
参数菜单可调整主 ZIG 幅度（默认10%）与卖线均线周期（默认3），其他参数保留原公式数值。

计算代码位于 `src/utils/waveSignals.js`，绘制位于 `src/charts/kline/waveIndicator.js`。
移植口径与限制：

- ZIG 使用收盘价百分比转向、极值间线性插值，末端保留临时折线；TROUGHBARS 的零距离条件
  以已经确认的波谷位置实现。历史信号会重绘，不能当作当时已知的实时买卖点。
- SMA 按 `(M*X+(N-M)*前值)/N` 递推，从首个有效值初始化，支持原式的4.1周期；EMA 同样从
  首个有效值初始化。MA 需要完整窗口，LLV/HHV/COUNT 在开头使用已有历史。除零不生成短买点。
- 重名变量按原式各计算块隔离，保留原式买点3中 VAR1A 与价格均线比较的条件，未擅自修正策略。
  未被输出引用的 COST、MA10/20 等中间量不计算。VERLINE 按共振条件绘制副图竖线。
- 原式多层渐变 STICKLINE 简化为对应趋势色的K线实体；信号色柱保留价格区间。图标7/8改为
  上/下三角。原式“游资进”的基线+0.2及其他绝对价格条件原样保留，未按ETF价格缩放。
- 使用接口换手率替代 V/CAPITAL*100，避免猜测流通份额及单位。饱和度缺少成交额时显示空值。
- 原软件的端点、初始化及图标样式可能不同；尚未与原软件逐根对照。未复权行情的除息价格变化、
  已加载历史长度和持续回补都会影响信号。长期EMA在短历史上的初值影响较大。
