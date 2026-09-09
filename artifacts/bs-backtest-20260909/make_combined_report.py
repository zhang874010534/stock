import json
from pathlib import Path
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
p=Path(__file__).resolve().parent
load=lambda name:json.loads((p/name).read_text(encoding='utf-8'))
s=load('combined-summary.json');d=load('combined-details.json');b=load('buyHold-details.json');r=s['strategy'];bh=s['buyHold'];sig=load('combined-signals.json')
f=lambda x:'—' if x is None else f'{x*100:.2f}%'
m=lambda x:f'{x:,.2f}'
alias={'共振买点':'红线','转向买':'B','波段卖':'波段卖','转向卖':'S'}
name=lambda es:'＋'.join(alias[e['name']] for e in es)
markers=lambda es:'；'.join(f"{alias[e['name']]}：{e['markerDate']}" for e in es)
plt.rcParams['font.sans-serif']=['Microsoft YaHei','DejaVu Sans'];plt.rcParams['axes.unicode_minus']=False
fig,axes=plt.subplots(2,1,figsize=(11,6.5),sharex=True,gridspec_kw={'height_ratios':[3,1]})
for data,label,color in [(d,'红线或B买入；波段卖或S卖出','#287bb3'),(b,'买入持有','#40a080')]:
 dates=[datetime.fromisoformat(e['date']) for e in data['equity']]
 axes[0].plot(dates,[e['equity']/10000 for e in data['equity']],color=color,label=label,lw=1.6)
 axes[1].plot(dates,[e['drawdown']*100 for e in data['equity']],color=color,lw=1)
axes[0].set_title('512890｜四类波段信号逐日回测：首次出现执行，消失不操作',loc='left',fontsize=13,pad=15)
axes[0].legend(frameon=False,loc='upper left');axes[0].set_ylabel('账户权益（万元）');axes[1].set_ylabel('回撤（%）')
for ax in axes:ax.grid(alpha=.2);ax.spines[['top','right']].set_visible(False)
axes[1].xaxis.set_major_locator(mdates.YearLocator());axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
fig.text(.07,.015,'2022-01-04—2026-09-09；初始10万元；次日开盘；单边万一佣金（最低5元）＋万五滑点。',fontsize=9,color='#555')
fig.tight_layout(rect=[0,.045,1,1]);fig.savefig(p/'combined-equity.png',dpi=150);plt.close(fig)
lines=['# 红线/B买入，波段卖/S卖出：完整回测','',
'**512890日线，2022-01-04—2026-09-09，共1,136根：15笔完整交易，10胜5负，胜率66.67%；扣费用后总收益22.71%，年化4.47%，最大回撤9.92%，期末权益122,707.76元，空仓。**','',
'## 先核对指定日期','',
'下列日期来自逐日只输入已知行情的完整公式回放。B=转向买，S=转向卖，红线=共振买点（vertical）。','',
'| 标记所在日期 | 首次观察日期 | 类型 | 512890策略处理 |','|---|---|---|---|',
'| 2026-01-09 | 2026-01-09 | 共振红线 | 1月12日开盘买入 |',
'| 2026-01-19 | 2026-01-19 | 共振红线 | 已持仓，忽略重复买点 |',
'| 2026-05-29附近（5月25日至6月5日） | — | 无四类信号新增，亦无后来首次回填到这一区间的四类信号 | 不产生交易 |',
'| 2026-07-01 | 2026-07-01 | B＋共振红线 | 已在6月24日买入，继续持仓 |',
'| 2026-08-04 | — | 当日无四类信号新增 | 已在7月17日卖出，继续空仓 |','',
'关键补充：2026-07-16已首次出现“波段卖”，故7月17日卖出。7月24日、7月31日还出现S/卖出信号，但当时已空仓。','',
'**5月29日的差异找到了：H30269指数在当日收盘回放确有共振红线（还伴随★绝佳），512890 ETF没有。** 用2022年以来的扩展数据和网页当前本地较短数据分别核对，结果一致。因此不能把指数上的该买点直接算作“ETF自身信号”。本报告严格按用户指定的512890自身信号交易，没有混入指数信号。8月4日的首次卖出未在两者当前默认公式的当日K线上复现。','',
'## 公式与成交规则','',
'- 直接调用项目 calculateWaveSignals，每个交易日都从历史起点重算到当天，不读取后续行情。默认 zigPercent=10、sellPeriod=3；“波段卖”的5% ZIG为原公式固定值。',
'- 仅收集共振买点、转向买、波段卖、转向卖四类事件。★绝佳、精准买、波段买等没有纳入。红线来自vertical，与同名共振买点事件对应。',
'- 使用“标记所在K线日期＋事件名称”去重，首次观察到时永久写入记录。没有新事件时不交易，信号消失不触发买卖，不删除已有成交。',
'- 已持仓只响应新增卖点，空仓只响应新增买点。重复同方向信号忽略；买卖同日冲突卖出优先，空仓不买。本样本没有同日新增买卖冲突。',
'- 后来回填到较早K线的信号按首次观察日处理，下一交易日开盘成交，不能回到标记日期交易。',
'- 同一日期同一类型的旧标记再次出现不当作新的首次信号。',
'- 初始现金100,000元，只做多，全仓/清仓，100份整数交易。单边佣金万一、最低5元；单边滑点万五。现金不计息，无额外止盈止损。',
'- 买入成交价=下一日开盘价×1.0005；卖出成交价=下一日开盘价×0.9995，再扣佣金。管理费用已体现在ETF行情中，不重复扣。',
'- 日末按收盘价盯市计算净值、年度收益与最大回撤。期末不强制清仓，当前策略实际为空仓；买入持有基准仍持仓。','',
'## 汇总对照','', '| 指标 | 四类信号策略 | 买入持有 |','|---|---:|---:|']
for label,key,fmt in [('期末权益（元）','finalEquity',m),('总收益','totalReturn',f),('年化收益','cagr',f),('最大回撤','maxDD',f),('已平仓交易数','trades',str),('盈利笔数','wins',str),('亏损笔数','losses',str),('胜率','winRate',f),('持仓日比例','exposure',f)]:lines.append(f'| {label} | {fmt(r[key])} | {fmt(bh[key])} |')
lines+=['','买入持有未卖出，因此已平仓交易数为0，胜率不适用。年化按样本自然日跨度复合折算，回撤是日末权益回撤，不包含完整盘中回撤。',
f"最大回撤峰值日{r['ddPeak']}，谷值日{r['ddTrough']}。平均持仓{r['avgHoldingBars']:.1f}个交易日，最长45个交易日，平均34.47个自然日。",'',
f"![净值和回撤]({(p/'combined-equity.png').as_posix()})",'',
'## 盈亏与成本','', '| 指标 | 结果 |','|---|---:|']
for label,key,fmt in [('平均单笔净收益','avgTrade',f),('盈利单平均收益','avgWin',f),('亏损单平均收益','avgLoss',f),('平均盈利/平均亏损幅度','payoffRatio',m),('总盈利金额/总亏损金额','profitFactor',m),('最佳单笔','bestTrade',f),('最差单笔','worstTrade',f),('累计佣金（元）','totalFees',m),('累计滑点金额（元）','totalSlippage',m)]:lines.append(f'| {label} | {fmt(r[key])} |')
lines+=['',f"不计手续费和滑点时总收益{f(s['noCost']['totalReturn'])}；计入后{f(r['totalReturn'])}。成本引起的期末权益差还包含复利与整数份额效应，不等于直接费用金额之和。",'',
'## 年度收益','', '| 年份 | 四类信号策略 | 买入持有 |','|---|---:|---:|']
for y,v in r['annual'].items():lines.append(f'| {y} | {f(v)} | {f(bh["annual"][y])} |')
lines+=['','2026年仅截至9月9日；年度收益按年末/样本末权益计算，包含跨年度未平仓盈亏。','',
'## 全部15笔成交','',
'表中价格为原始开盘价，净收益已扣双边滑点、佣金。初始10万元滚动复利，所以相同收益率对应的金额会随账户权益变化。','',
'| # | 买入日 | 买入触发 | 买入开盘 | 卖出日 | 卖出触发 | 卖出开盘 | 持仓交易日 | 净收益 | 净盈亏（元） |','|---:|---|---|---:|---|---|---:|---:|---:|---:|']
for i,t in enumerate(d['trades'],1):lines.append(f"| {i} | {t['buyDate']} | {name(t['buySignals'])} | {t['buyOpen']:.3f} | {t['sellDate']} | {name(t['sellSignals'])} | {t['sellOpen']:.3f} | {t['holdingBars']} | {f(t['return'])} | {m(t['pnl'])} |")
lines+=['','## 逐笔信号日期审计','',
'以下把“画在哪天”和“哪天才看到”分开。观察后的下一交易日成交见上表。','',
'| # | 买点标记日期（类型） | 首次观察买点 | 卖点标记日期（类型） | 首次观察卖点 |','|---:|---|---|---|---|']
for i,t in enumerate(d['trades'],1):lines.append(f"| {i} | {markers(t['buySignals'])} | {t['signalDate']} | {markers(t['sellSignals'])} | {t['sellSignalDate']} |")
lines+=['','## 回填与事件总数','', '| 类型 | 首次观察记录数 |','|---|---:|']
for k,v in s['signalsByType'].items():lines.append(f'| {k} | {v} |')
lines+=['','事件数不等于成交数：持仓期间的新买点、空仓期间的新卖点不会成交。','',
'本样本发现以下延迟回填事件，均没有回溯成交：','', '| 类型 | 标记日期 | 首次观察日期 | 延迟交易日 |','|---|---|---|---:|']
for e in sig['ledger']:
 if e['delayBars']:lines.append(f"| {e['name']} | {e['markerDate']} | {e['observedDate']} | {e['delayBars']} |")
lines+=['','## 数据、验证和限制','',
'- 沿用已冻结东方财富2022年以来512890日线1,136根，与前复权数据逐日OHLC完全一致，未发现该区间复权差异；不额外添加未核实的分红现金流。不是成立以来回测。',
'- 当前网页本地ETF历史始于2025-02-18，主回测自2022-01-04初始化公式；截短历史可能影响信号，所以日期交叉核对同时跑了两种历史长度。',
'- 逐日直接调用完整指标，而非凭最终图倒推。全部观察记录保留markerDate、observedDate、类型和延迟；代码与数据SHA256记于combined-summary.json。',
'- 已验证数据OHLC和日期、信号之后成交、现金与份额非负、账户收益与已实现盈亏对账；另用人工构造事件测试“消失不操作”和“冲突卖出优先”。',
'- 仅15笔，66.67%不是未来保证。Wilson粗略95%区间41.71%—84.82%，还依赖独立交易的近似；没有独立样本外验证。',
'- 日线收盘回放无法还原盘中出现又在收盘前消失的信号，无法模拟盘中首次出现立即成交。',
'- 没有盘口深度、真实券商费率、开盘撮合成交失败和现金利息模型；假定样本交易日可按开盘价附近成交。',
'- ETF信号与指数信号不是同一口径，本次没有混合使用。','',
'## 可复现文件','',
'- 执行：`node artifacts/bs-backtest-20260909/backtest-combined.mjs`。',
'- 完整指标快照：waveSignals-snapshot.js；若项目公式日后改变，应以快照核验。',
'- 完整事件/消失记录及截面：combined-signals.json。',
'- 全部交易和每日净值：combined-details.json；汇总：combined-summary.json。',
'- 指定日期ETF/指数、长/短历史交叉核对：combined-date-crosscheck.json。',
'- 生成本报告及图表：`python artifacts/bs-backtest-20260909/make_combined_report.py`。','',
'本次严格规则下，四类信号降低了样本内最大回撤，但总收益明显低于买入持有。1月份遗漏的红线已纳入；5月29日的记忆对应指数买点，不能作为本次ETF买点。']
(p/'combined-report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Combined report and chart saved')
