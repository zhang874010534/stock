# 红利低波数据看板 · 东方财富数据

## 右侧估值分析

K 线放大视图的「简况 → 指数分析」中，PE / PB / 股息率下方展示估值小图，右上角「放大」打开独立弹窗。支持 PE / PB、近 1 / 3 / 5 年及全部范围；大小图共享选项，Esc 先关闭估值弹窗，保留 K 线全屏。底部滑块只改变可视区间，不改变分位统计样本。

历史文件为 `public/data/valuation-history-h30269.json`，由现有估值定时任务合并每日真实快照，同日期覆盖修订值、不同日期追加，禁止混用来源及口径。首次可执行 `python scripts/seed-valuation-history.py` 恢复 Git 中已保存的同来源快照；该命令不是上游完整历史回补。目前初始数据只有 2026-09-18 至 2026-09-24 的 5 个样本，完整历史来源仍待接入，不伪造一年曲线。

范围以最新估值日期为终点；分位数采用排序后的线性插值，历史排名采用 `(小于当前值数量 + 等于当前值数量 × 0.5) / 样本数 × 100%`。不足 20 个有效样本时不计算分位线和排名，历史不足所选时间范围时明确提示实际覆盖日期。当前来源未明确 TTM / 聚合口径，页面使用 PE / PB 标签；512890 展示标的指数 H30269 的估值。

当前首页行情由东方财富 K 线文件提供，PE / PB 由东方财富旗下天天基金的 H30269 指数估值接口提供，股息率使用中证 H30269 的 D/P1（总股本口径），中债继续提供十年期国债收益率。下文 AKShare 服务为保留的旧版可选 API，不参与当前首页取数。

本地预览只需 `npm ci`、`npm run dev`，读取 `public/data/` 已生成数据。

## 旧版可选 AKShare 服务

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

GitHub Actions 在每个工作日北京时间 16:30（UTC 08:30）运行 `npm run data:refresh-market`，更新
`public/data/h30269.json` 和 `public/data/512890.json`，随后生成统一最新指标。两只证券分别刷新最近 30 个自然日、回补一个 90 天窗口，并保存独立游标。数据有变化时一起提交行情、统一指标和来源失败状态 JSON，commit 信息为
`chore(data): update market data`；没有变化时不产生 commit。

执行时先分别更新并保存两个标的的近期行情，再回补历史，阶段之间间隔 3 秒。近期行情失败会保留旧数据、跳过该标的本轮回补，并将任务标记失败；其他标的继续处理。仅历史回补请求失败时给出 Actions 警告，保留回补游标，下次继续，不影响已保存的近期行情。文件读写或校验异常仍标记失败。网络失败日志附带可用的底层错误码（例如 `ECONNRESET`、`ENOTFOUND`），用于排查连接或 DNS 问题。失败任务仍会尝试提交已成功更新的数据。

需要手动执行时，进入 GitHub **Actions → Update H30269 and 512890 → Run workflow**。GitHub Actions
只负责数据更新与提交；Cloudflare 仍由原有 GitHub 集成在检测到新 commit 后负责 Build 和 Deploy。

## API 与扩展

### PE / PB 与十年期国债收益率

`python scripts/fetch-indicators.py` 独立更新以下数据（中证 XLS 解析依赖 `xlrd==2.0.2`）：

- `public/data/valuation-h30269.json`：东方财富 / 天天基金 `FundSpecialZSB30ZSIndex` 接口，指数代码校验为 H30269；`Petim` 为 PE、`PB` 为市净率、`PDate` 为估值日期。保存原始精度，页面显示两位小数。未确认 TTM 和加权口径，不能标为 PE-TTM，也不与其他来源历史数据拼接。此接口不提供股息率。
- `public/data/dividend-h30269.json`：中证 H30269 每日指标文件的 D/P1（总股本口径，百分数），512890 与 H30269 共用此指数股息率，显示原始数据日期与来源，不代表 ETF 实际现金分红收益率。
- `public/data/china-bond-10y.json`：中债国债到期收益率曲线的 10 年期限值。

512890 页面明确标为“标的指数 PE / PB”，展示 H30269 指数估值。各项独立显示数据日期和来源。历史分位暂不接入，因为上游分位的计算区间未确认。

独立工作流 `Update valuations and yields` 在工作日北京时间 18:15 运行 `npm run data:refresh-indicators`，采集后生成统一指标，也支持手动运行。HTTP 错误及东方财富返回的业务失败会有限重试；错误、缺字段、非有限数值、错误代码或日期倒退时保留上次快照，不伪造当天数据。三项独立处理，失败任务仍提交成功更新的数据及失败状态。首次运行前执行 `python -m pip install -r scripts/requirements-indicators.txt`，无需 AKShare。工作流与行情任务共享提交锁。

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

## 最新指标计算规则（阶段二）

日期：2026-09-26。规则版本：`latest-metrics-v2-all-history`。状态：阶段五详细说明和自动更新编排已实现；远端工作流运行及窄屏实测待最终验收。

调研依据：[第一阶段数据源调研](docs/research/latest-metrics-stage1-2026-09-26.md)。

本节作为六项最新指标的实现规格，取代阶段一报告中十项指标的实施范围。固定 0% 无风险利率是首版设计假设，不是用户指定或实际市场利率。

### 1. 范围与数据源

| 字段 | 页面名称 | 数据源及口径 | 单位／显示 |
| --- | --- | --- | --- |
| `pe` | 市盈率 PE | 东方财富／天天基金 `Petim`，沿用来源值 | 倍，2 位小数 |
| `pb` | 市净率 PB | 东方财富／天天基金 `PB`，沿用来源值 | 倍，2 位小数 |
| `dividendYield` | 股息率 | 中证指数 D/P1，总股本口径 | 百分数，2 位小数 |
| `annualReturn` | 年化收益率（全部历史） | H30269 价格指数日收盘价，日历时间复合年化 | 百分数，2 位小数，允许负数 |
| `maxDrawdown` | 最大回撤（全部历史） | 同一窗口日收盘价，期间峰值至后续谷值最大跌幅 | 非负百分数，2 位小数 |
| `sharpe` | 夏普比率（全部历史） | 同一窗口日收益，年化、无风险利率固定 0% | 无单位，2 位小数，允许负数 |

- 本次不展示或预留 PS、PCF、ROE、资产负债率，不引入理杏仁 Token 依赖。
- PE 不标 TTM，PB 不标 MRQ；说明中写明“来源未明确财报及聚合口径”。不因名称猜测其规则，不切换为中证 PE 混用。
- 股息率直接取 D/P1，不切换 D/P2，不把价格涨跌加上当前股息率当作全收益。
- 六项均属于 H30269。512890 页面复用时整体标为“标的指数最新指标”，仍从 H30269 日线计算；不拿 ETF 行情替换。
- 十年期国债收益率继续独立展示，不参与本版夏普计算。

### 2. 统一统计窗口

收益、回撤和夏普使用一个窗口，独立于 K 线日／周／月切换、缩放、鼠标悬停和选中区间。

1. `T` 为已同步的 H30269 最新有效日线日期，按中国市场日期处理，不以打开页面当天作为收益截止日。
2. 起点 `S` 为当前已同步历史中的第一条有效日线日期。使用全部历史，不再从 T 向前截取一年，也不随 K 线可见区间改变。
3. 取 S 至 T 的全部日收盘价，首尾都包含；校验整个区间的预期交易日，缺日或坏数据不静默跳过。
4. 至少两个收盘点才能计算年化收益和回撤；夏普至少需要两个日收益观测且波动非零。不足一年仍按实际自然日年化，页面额外提示“历史不足一年，年化结果仅供参考”。
5. 展示“全部历史”及实际起止日期。“全部”仅指当前已同步的数据，不代表指数成立以来；补入更早数据会重新计算三项，不同起点的指数结果不宜直接横向比较。

价格序列不含现金分红再投资，不包含 ETF 管理费、交易成本或跟踪误差。页面公共说明使用“全部历史 · 价格指数（不含分红再投资）”。

### 3. 公式

设窗口收盘价为 P[0] 至 P[n]，n 是收益观测数，D 是 S 至 T 的实际自然日差。计算保留原始精度，最后显示时再舍入。

#### 年化收益率

`annualReturn = (P[n] / P[0])^(365 / D) - 1`

使用 ACT/365 固定年基准；跨闰年仍使用 365，不切换成年内交易日条数。此规则是项目约定。恰好 365 天时等于区间累计收益，不用日收益算术均值代替。

#### 最大回撤

`peak[i] = max(P[0], ..., P[i])`

`drawdown[i] = 1 - P[i] / peak[i]`

`maxDrawdown = max(drawdown[0], ..., drawdown[n])`

仅用日收盘价，不混用最高价／最低价。峰值限定在当前窗口；窗口外峰值不纳入。记录对应峰值和谷值日期；相同峰值取最早日期，相同最大回撤取最早谷值，无回撤时为 0，峰谷日期可为 null。

#### 夏普比率

`r[i] = P[i] / P[i-1] - 1`，i=1,...,n。

首版 `annualRiskFreeRate = 0`，`dailyRiskFreeRate = 0`，`x[i] = r[i] - dailyRiskFreeRate`。

`mean = sum(x[i]) / n`

`sampleStd = sqrt(sum((x[i] - mean)^2) / (n - 1))`

`sharpe = sqrt(252) * mean / sampleStd`

- 日收益使用简单收益率，标准差使用样本标准差（n−1）；252 是固定年化参数，不随当年交易日数量变化。
- 无风险利率固定为 0% 是可复现的基准假设，并不代表市场实际利率；与采用同期存款／国债利率的平台不可直接比较。
- 页面必须在夏普附近可见地标注“无风险利率假设 0%”，不能只藏在说明弹窗。夏普数值不乘 100，不加百分号。
- 不使用“几何年化收益率 ÷ 年化波动率”替换此公式。
- `n < 2` 或 `sampleStd <= 1e-12` 时夏普显示“—／样本不足或波动为零”，不输出无穷大；不影响有效的年化收益和回撤。
- 后续若采用非零或历史利率，必须升级规则版本，明确利率期限、对齐及转换方法并重算，不静默改变现有定义。

夏普的均值／标准差基础定义参考 [William F. Sharpe, The Sharpe Ratio (1994)](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm)。0% 基准、252 年化和本项目窗口是实现选择，不是论文对该指数的规定；平方根年化不作自相关修正。

### 4. 有效性、日期及缺失处理

- 数据身份必须为 H30269；严格校验日期、有限数值、重复日期和收盘价 > 0。允许排序但不静默丢弃坏记录、覆盖重复值或补零。
- 对当前窗口核对交易日历，不以“周一至周五”直接代替交易日。补班周末仍需按交易所日历判断。
- 起点、终点或窗口内预期交易日缺失，三项计算值均不发布新值；不跨缺失交易日当成一个日收益，也不前值填充或插值。
- 日历未覆盖窗口时，显示“交易日历待核验”，不假定完整。日历当前覆盖 2023–2026，补入更早数据或滚入新年份前须扩展官方日历。
- 本地文件中的 `latest` 与最后一条历史记录必须一致。T 不得为未来日期、休市日或尚未收盘的当日；全部日线为收盘数据。
- PE／PB 沿用现有快照的有限正数校验；收到非正值视为该源本版不支持的输入，不展示为正常估值。股息率使用百分数单位、有限且在 0–100 范围内，0 是有效值。
- 空字符串、null、布尔值不转换为 0；缺失值显示“—”。前端不显示 NaN、Infinity 或 -0.00。
- PE／PB 显示其 PDate，股息率显示中证原始日期，三项计算显示 S—T。抓取时间 `updatedAt` 不能冒充数据日期。
- 来源间不强行对齐或插值。某指标日期早于最新行情日期，提示“截至该日”；不把日期较旧等同于请求失败。
- 采集失败可以保留旧值，但显示“更新失败，保留上次数据”和原日期。旧计算结果须整体保留原窗口、版本与状态，不可挂在新的 T 下。
- 无旧值时显示“暂无数据／原因”。坏数据不能覆盖旧的有效快照。单项失败不遮挡其他有效指标。

### 5. 数据输出约定

继续兼容现有原始文件：东方财富 PE／PB 单位为倍，中证 D/P1 文件的 4.27 表示 4.27%。

新增统一指标层将收益类百分数统一存成小数比例：股息率读取原值后除以 100；`annualReturn=-0.02748`、`maxDrawdown=0.16183`。前端仅在格式化 ratio 类型时乘以 100，避免重复转换。PE、PB 和夏普不转换。

每项至少带：`value`（缺失为 null）、`unit`（multiple／ratio／dimensionless）、`source`、`basis`、`asOf`、`status` 和失败原因。统一输出带 `schemaVersion`、`ruleVersion`、`code`、`generatedAt`。三项计算共用 `windowStart`、`windowEnd`、`priceCount`、`returnCount`、`calendarVerified`、`annualizationSessions=252`、`annualRiskFreeRate=0`、`riskFreeMode=fixed_assumption` 和行情输入摘要，方便复核。

### 6. 原近一年规则的历史试算（留作对照，不是当前展示值）

按上交所 [2025 年休市通知](https://www.sse.com.cn/disclosure/announcement/general/c/c_20241223_10767108.shtml)及 [2026 年休市通知](https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml)构造本次窗口的预期日期集合，与本地 H30269 日线逐日比较：

- 窗口：2025-09-24 至 2026-09-24，365 个自然日。
- 预期 243 个收盘点，实际 243 个，无缺失或额外日期，形成 242 个日收益观测。该检查仅针对当前窗口，不是完整历史或未来日历验证。
- 起始收盘 11155.50，末日收盘 10848.95。
- 年化收益率：-2.7479718524%，显示 **-2.75%**。
- 最大回撤：16.1825639115%，显示 **16.18%**；峰值日期 2025-11-12，谷值日期 2026-06-30。
- 夏普比率（固定 0%）：-0.1682892919，显示 **-0.17**。

试算与来源摘要保存于 [阶段二参考结果](docs/research/latest-metrics-stage2-reference-2026-09-26.json)。这些是旧版近一年窗口的验证值，保留作公式对照；当前 v2 已改用全部历史，不能用本节数值作为当前页面验收值。与参考截图不一致不是调整公式凑数的理由。

### 7. 阶段三验收要求

验证范围：固定公式样本；全部历史起止日期；跨闰年 ACT/365；补入更早峰值会改变回撤；整个区间缺日；不足一年及单点／双点历史；全程横盘（收益和回撤 0、夏普无值）；恒定非零日收益（零波动夏普无值）；负收益；旧值保留；股息率单位转换及负零格式化。日期边界用固定测试数据，不依赖运行当天。

界面使用同一份六项数据，切换页签、K 线周期和标的时保持上述口径。页面已接入，定时工作流已接入统一指标生成。

### 8. 数据层使用（阶段三已完成）

执行以下命令，从已有行情、估值和股息率文件生成统一指标：

```powershell
npm run data:metrics
```

- 输入：`public/data/h30269.json`、`valuation-h30269.json`、`dividend-h30269.json`。
- 输出：`public/data/latest-metrics-h30269.json`。原始输入文件保持不动；这个命令不访问上游，也不把旧快照日期改成当天。
- 需要刷新来源时，运行 `npm run data:refresh-market` 或 `npm run data:refresh-indicators`。两者会采集、记录分来源结果并生成统一指标；GitHub Actions 已改用这两个入口。旧的原始采集命令仍可诊断使用，但不记录统一指标的恢复状态。
- `scripts/build-latest-metrics.mjs` 原子写入输出，无变化不重写；出现缺数据或保留旧数据时写入对应状态并返回非零退出码。仅零波动导致夏普不可计算不视为采集失败。
- `src/utils/latestMetrics.js` 提供严格计算、分项数据整合、状态校验和单位格式化。`buildLatestMetrics`／`generateLatestMetrics` 接受 `inputErrors`（market、valuation、dividend）；生成器同时读取编排器保存的来源失败状态，仅凭原文件较旧不能推断采集失败。
- `src/api/latestMetrics.js` 提供 `getLatestMetrics()`，固定读取 H30269 的统一文件并校验；右侧 `LatestIndexMetrics` 组件已调用。
- 状态 `ok` 表示该日期数据有效；`stale` 表示失败后保留旧值；`unavailable` 表示没有可用值。三项计算失败时整体保留旧窗口和输入摘要。收益类单位统一为 ratio；夏普为 dimensionless。
- `src/data/tradingCalendar.js` 附上交所官方来源，日历覆盖 2023–2026。统计窗口超出覆盖时停止生成新的收益风险指标；需根据官方通知扩展日历，不能自动推算节假日。
- 各项使用当前本地输入的原始日期，各自的 `asOf` 不合并成一个虚假的最新日期。规则升级后重算统一快照，不把 v1 近一年结果当作 v2 全部历史旧值保留。

针对性验证：`node --test tests/latestMetrics.test.js`。测试含公式解析样本、日历边界、缺日、零波动、坏输入、日期倒退、旧值保留、文件生成及读取接口；另与阶段二独立试算交叉核对（市场输入摘要变化后跳过该快照对照，固定公式测试持续运行）。

### 9. 最新指标界面（阶段四）

- 入口：全屏行情右侧「简况 → 指数分析」。展示市盈率、市净率、股息率、全部历史年化收益率、最大回撤和夏普比率。ETF 页面明确标为「标的指数最新指标」，仍使用 H30269 数据。
- 延续深色样式；窄侧栏每行一项，指标容器宽度达到 480px 时使用双列布局。各项保留原始数据日期，收益风险指标展示共同计算窗口。
- 股息率注明中证总股本口径；夏普附近展示「无风险利率假设 0%」，数值不带百分号。国债收益率继续独立展示，不参与本版夏普计算。首页原股息率卡片保持原有行为。
- 支持加载、请求失败重试、刷新失败保留已显示数据，以及单项旧值和无值原因。刷新按钮只重新读取统一 JSON 快照，不抓取上游或重算指标。
- 界面提供来源链接及基本口径说明；阶段五增加了「查看指标说明」折叠区域，说明六项指标、计算范围及异常处理。

验证：`node --test tests/latestMetricsComponent.test.js tests/latestMetrics.test.js`，17 项通过，1 项因本地行情摘要已变化而跳过历史快照对照；`npm run build` 通过。阶段四桌面已检查六项展示、指数详情／指数分析切换及 K 线周期切换；全部历史调整通过组件测试确认标注及起止日期。窄屏实测仍待完成。

### 10. 全部历史范围调整

三项收益风险指标已统一使用当前全部历史，规则版本升级为 `latest-metrics-v2-all-history`，输出增加 `windowMode=all_history` 并校验计算点数等于输入历史点数。旧版近一年快照不会被误展示为全部历史。PE、PB 和股息率的数据口径不变。

交易日历补入上交所 [2023 年休市安排](https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20221227_5714459.shtml)和 [2024 年休市安排](https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20231226_5733941.shtml)。全区间继续检查缺失交易日，不能用简单工作日历替代。

本次生成时本地 H30269 区间为 2023-03-01 至 2026-09-17，共 864 个收盘点、863 个日收益观测；这是一份数据快照，后续以生成文件中的实际区间为准。生成命令仍为 `npm run data:metrics`。

### 11. 指标说明及自动更新（阶段五）

右侧「查看指标说明」可展开查看六项定义、计算公式、全部历史范围、分红和无风险利率假设，以及日期／缺失值处理。使用原生折叠控件，支持键盘操作；页面刷新按钮仍只读取快照。

本地完整更新入口：

```powershell
npm run data:refresh-market
npm run data:refresh-indicators
```

- 行情入口更新两只证券，再生成统一指标。H30269 近期更新或文件处理失败会保留三项旧结果及原窗口；512890 单独失败不影响 H30269 指标。可延后的历史回补请求失败仍沿用原警告规则，按当前已同步历史计算。
- 指标入口调用 Python 采集并读取临时结果报告。PE／PB、股息率分别传播成功／失败；国债失败只影响任务结果，不将六项指标误标为失败。Python 不可用或报告缺失时，相关来源按失败处理。
- `public/data/latest-metrics-source-status.json` 由首次完整更新创建，保存 `schemaVersion: 1` 和 `errors`（market、valuation、dividend）。两套任务只清除本次明确成功的来源状态，保留其他来源的失败。单独运行 `data:metrics` 也读取此文件，不会把未恢复的来源误标正常。不要通过删状态文件代替重新采集。
- 各任务将成功原始数据、统一指标及来源状态一起提交；部分失败也先提交可用更新和状态，再将工作流标记失败。无内容变化不产生提交。沿用共享并发组，避免两个定时任务同时写入。
- 本阶段仅修改本地代码和工作流配置，未提交／推送或触发远端任务。定时逻辑需在代码进入远端默认分支后生效；最终验收仍需验证远端任务和部署链路。

验证：Node 针对性测试覆盖跨任务失败保留、来源独立恢复、报告缺失、原区间保留、旧值显示及公式；Python 单元测试覆盖分项报告和原有采集解析。测试使用隔离数据和模拟采集结果，不以真实网络成功作为断言。构建通过。

### 12. 指数详情

右侧「简况 → 指数详情」提供指数速览：指数说明、全称、代码、成分股数量、总市值和编制方式原文入口。512890 页面标明资料属于 H30269 标的指数。

基础资料根据[中证官方编制方案](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30269_Index_Methodology_cn.pdf)整理，50 只为方案规定的样本数，并非实时成分股统计。“更多”链接到官方指数单张 PDF，“查看原文”链接到编制方案 PDF。当前没有接入总市值数据源，该项显示“—／暂无数据”，不使用参考截图中的数值。

### 13. 成分股及自动更新

右侧「成分股」显示 H30269 官方完整名单，含证券代码、名称、沪深市场，支持代码／名称搜索。512890 页面明确标为标的指数成分股，不代表 ETF 实际持仓。按代码排序；官方名单不提供权重，不填充推算权重。

来源：[中证官方成分股 XLS](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/cons/H30269cons.xls)。首次已获取 2026-09-24 的 50 只样本，存储于 `public/data/constituents-h30269.json`。页面展示文件内的数据日期，抓取时间不替代数据日期。

手动更新：`npm run data:constituents`，需要安装 `scripts/requirements-indicators.txt` 中的 xlrd。工作日北京时间 18:15 的 `Update valuations and yields` 工作流增加独立采集步骤，与指标更新分别处理失败，并一起提交成功数据和失败状态。配置推送到远端默认分支后定时生效，当前未触发远端任务。

采集校验指数身份、统一日期、50 只样本、六位代码、去重、名称及交易所；拒绝未来日期、日期倒退及不完整文件。失败保留上次名单及日期并标记 stale，无旧数据时标记 unavailable；恢复后清除失败标记。若官方修改样本数量或文件结构，需要核实并更新校验规则。内容不变时不改写文件。

验证：`python -m unittest discover -s tests -p test_constituents.py`、`node --test tests/constituents.test.js`，以及 `npm run build`。
