import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
p=Path(__file__).resolve().parent
s=json.loads((p/'summary.json').read_text())
d={k:json.loads((p/f'{k}-details.json').read_text()) for k in s['results']}
r=s['results']
plt.rcParams['font.sans-serif']=['Microsoft YaHei','DejaVu Sans']
plt.rcParams['axes.unicode_minus']=False
fig,axes=plt.subplots(2,1,figsize=(12,7),sharex=True,gridspec_kw={'height_ratios':[3,1]})
for key,label,color in [('historical','最终历史信号（含未来信息）','#b08a47'),('observed','逐日观察最新 B/S 状态','#2475b8'),('buyHold','买入持有','#36a277')]:
 e=d[key]['equity'];dates=[datetime.fromisoformat(x['date']) for x in e]
 axes[0].plot(dates,[x['equity']/10000 for x in e],label=label,color=color,linewidth=1.6)
 axes[1].plot(dates,[x['drawdown']*100 for x in e],color=color,linewidth=1)
axes[0].set_title('512890：B/S 策略回测 | 2022-01-04 至 2026-09-09',loc='left',fontsize=15,pad=15)
axes[0].set_ylabel('账户权益（万元）');axes[1].set_ylabel('回撤（%）')
axes[0].legend(loc='upper left',frameon=False)
for a in axes:
 a.grid(alpha=.2);a.spines[['top','right']].set_visible(False)
axes[1].xaxis.set_major_locator(mdates.YearLocator());axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
fig.text(.08,.015,'初始10万元；次日开盘成交；单边佣金万一（最低5元）＋滑点万五；收盘盯市，期末持仓未强制卖出。',fontsize=9,color='#555')
fig.tight_layout(rect=[0,.045,1,1]);fig.savefig(p/'equity.png',dpi=150);plt.close(fig)
f=lambda x:'—' if x is None else f'{x*100:.2f}%'
m=lambda x:f'{x:,.2f}'
lines=['# 红利低波 ETF：B/S 买卖点回测报告','',
'回测对象：512890 华泰柏瑞红利低波ETF。数据：2022-01-04—2026-09-09，共1,136根日线。',
'', '**结论：按最终历史图，4笔已平仓全部盈利，收益156.87%；按每天实际可见的最新B/S状态交易，39笔中17笔盈利，胜率43.59%，收益36.26%，低于买入持有的52.23%。不能把历史图100%的胜率理解为实时胜率。**','',
'## 口径与可复现性','',
'- 默认 ZIG=10%，取项目真实“转向买/转向卖”事件；不是“波段买/波段卖”，也不使用其他信号。“卖线均线周期=3”不影响B/S触发。',
'- 初始现金100,000元，空仓开始，只做多；B全仓买，S全部卖。同方向重复信号不加仓；空仓遇S忽略。',
'- 每日收盘计算，下一交易日开盘执行。买价=开盘价×1.0005，卖价=开盘价×0.9995；另收单边佣金万一、最低5元。100份整数交易，现金不计息，无杠杆。成本是假设，不是券商报价。',
'- 收盘盯市计算权益和最大回撤；期末持仓不强平、不扣未发生的退出费用。胜率只统计完整平仓交易，总收益包括未实现盈亏。日内回撤可能更大。',
'- 不假设在B/S显示高度成交，也不在信号当天开盘成交；缺少下一交易日数据的信号保留为待执行。',
'- 未复权OHLC用于对齐当前代码。另下载同区间前复权行情，两份数据逐日OHLC完全一致，本区间未发现复权差异；没有额外加一次股息收益。2021年的份额拆分不在样本范围内。',
'- 不是成立以来回测。所有主结果从2022年开始初始化ZIG；项目加载历史长度不同会影响早期信号。未用参数搜索结果替换默认10%。','',
'三种信号定义：','',
'1. **最终历史信号（理想化）**：一次性输入全样本，按最终留下来的B/S所在日期发信号，次日成交。故意保留前视偏差，用来回答“忽略回头影响”的假设。',
'2. **逐日观察最新状态（实际观察口径）**：第t日只输入截至t日的数据，找到当时图上最靠右的B/S；其类型相对昨日变成B或S，才在t日发出信号，t+1开盘成交。标记可能出现在较早K线上，但绝不回溯成交；S消失后最新标记恢复为B，也视为状态变B。',
'3. **仅当天K线新标记（严格口径）**：仍逐日重算，但只接受当天最后一根K线上的B/S，忽略后来补到较早K线的标记。这和口径2是不同策略，不能混用胜率。','',
'## 主要结果','',
'| 指标 | 最终历史信号 | 逐日观察最新状态 | 买入持有 |','|---|---:|---:|---:|']
for label,key,fmt in [('期末权益（元）','finalEquity',m),('总收益','totalReturn',f),('年化收益','cagr',f),('最大回撤','maxDD',f),('完整交易数','trades',str),('盈利笔数','wins',str),('亏损笔数','losses',str),('胜率','winRate',f),('持仓日比例','exposure',f)]:
 lines.append('| '+label+' | '+' | '.join(fmt(r[k][key]) for k in ['historical','observed','buyHold'])+' |')
lines+=['','买入持有不在期末卖出，所以完整交易数为0、胜率不适用。最终历史信号仍有一笔未平仓，逐日观察口径期末空仓。','',
f'![权益与回撤]({(p / "equity.png").as_posix()})','',
'## 理想化历史交易明细（完整交易）','',
'| B日期 | 买入日 | 开盘价 | S日期 | 卖出日 | 开盘价 | 持有交易日 | 净收益率 | 净盈亏（元） |','|---|---|---:|---|---|---:|---:|---:|---:|']
for t in d['historical']['trades']:
 lines.append(f"| {t['signalDate']} | {t['buyDate']} | {t['buyOpen']:.3f} | {t['sellSignalDate']} | {t['sellDate']} | {t['sellOpen']:.3f} | {t['holdingBars']} | {f(t['return'])} | {m(t['pnl'])} |")
o=r['historical']['openPosition']
lines+=['',f"未平仓：B日期{o['signalDate']}，{o['buyDate']}以开盘价{o['buyOpen']:.3f}（另计滑点）买入{o['shares']:,}份；期末收盘价{o['lastClose']:.3f}，浮盈{m(o['pnl'])}元，持仓回报{f(o['return'])}。不纳入4笔胜率。",'',
'## 逐日观察口径：盈亏质量','',
'| 项目 | 数值 |','|---|---:|']
for label,key,fmt in [('平均每笔收益','avgTrade',f),('盈利交易平均收益','avgWin',f),('亏损交易平均收益','avgLoss',f),('平均盈利/平均亏损幅度','payoffRatio',m),('总盈利金额/总亏损金额','profitFactor',m),('最佳单笔','bestTrade',f),('最差单笔','worstTrade',f),('平均持仓交易日','avgHoldingBars',m),('累计佣金（元）','totalFees',m),('累计滑点金额（元）','totalSlippage',m)]:lines.append(f'| {label} | {fmt(r["observed"][key])} |')
lines+=['',f"不计佣金与滑点时，该口径总收益为{f(r['observedNoCost']['totalReturn'])}；计入成本后为{f(r['observed']['totalReturn'])}。",'',
'胜率的粗略Wilson 95%区间为29.30%—59.02%；它还假设交易独立，实际交易存在时间相关性，因此不是未来胜率保证。历史口径只有4笔交易且含前视，不能做可信的成功率推断。','',
'## 逐年收益（账户收盘盯市）','', '| 年份 | 最终历史信号 | 逐日观察最新状态 | 买入持有 |','|---|---:|---:|---:|']
for y in r['historical']['annual']:
 lines.append('| '+y+' | '+' | '.join(f(r[k]['annual'][y]) for k in ['historical','observed','buyHold'])+' |')
lines+=['','2026年为截至9月9日的部分年度；年度盈亏包含未平仓浮动，不等于当年平仓交易盈亏。','',
'## 参数敏感性（逐日观察口径，样本内探索）','', '| ZIG幅度 | 完整交易 | 胜率 | 总收益 | 最大回撤 |','|---|---:|---:|---:|---:|']
for x in s['sensitivity']:
 q=x['observed'];lines.append(f"| {x['percent']}% | {q['trades']} | {f(q['winRate'])} | {f(q['totalReturn'])} | {f(q['maxDD'])} |")
lines+=['','不能因为12%在这段数据较好，就认定它是最优参数；15%出现亏损，说明结果对参数敏感。这里没有独立样本外验证。','',
'## 不同起始日期（空仓起步，沿用2022年以来历史计算信号）','', '| 起始日 | 逐日观察交易数 | 胜率 | 逐日观察收益 | 买入持有收益 |','|---|---:|---:|---:|---:|']
for w in s['windows']:
 q=w['observed'];lines.append(f"| {q['start']} | {q['trades']} | {f(q['winRate'])} | {f(q['totalReturn'])} | {f(w['buyHold']['totalReturn'])} |")
lines+=['','这些是重叠的子样本，不是独立样本外测试。','',
'## 严格只接受当天K线上B/S的结果','',f"完整交易{r['realtime']['trades']}笔，5胜0负，胜率100%；总收益{f(r['realtime']['totalReturn'])}，年化{f(r['realtime']['cagr'])}，最大回撤{f(r['realtime']['maxDD'])}，持仓日比例{f(r['realtime']['exposure'])}。仅5笔，且规则忽略了后来出现在较早K线上的B/S，不能用这个100%替代逐日观察口径的43.59%。",'',
'## 指数对照','',
'另以H30269指数自身收盘价生成信号、指数开盘点位进行理论交易，不计费用、无整数份额约束。指数不能直接买卖，这不是512890实盘结果，也不是用指数信号交易ETF。','',
'| 口径 | 完整交易 | 胜率 | 总收益 | 最大回撤 |','|---|---:|---:|---:|---:|']
for key,label in [('historical','最终历史'),('observed','逐日最新状态'),('buyHold','买入持有')]:
 q=s['indexResults'][key];lines.append(f"| {label} | {q['trades']} | {f(q['winRate'])} | {f(q['totalReturn'])} | {f(q['maxDD'])} |")
lines+=['','## 全部逐日观察交易（39笔）','',
'下表信号日是当日实际观察到最新B/S状态改变的日期，不是后来图上标记所在的历史日期。开盘价为未加滑点的行情原价；净盈亏已扣滑点和佣金。','',
'| # | 观察到B | 买入日 | 买入开盘 | 观察到S | 卖出日 | 卖出开盘 | 持仓交易日 | 净收益率 | 净盈亏（元） |','|---:|---|---|---:|---|---|---:|---:|---:|---:|']
for i,t in enumerate(d['observed']['trades'],1):lines.append(f"| {i} | {t['signalDate']} | {t['buyDate']} | {t['buyOpen']:.3f} | {t['sellSignalDate']} | {t['sellDate']} | {t['sellOpen']:.3f} | {t['holdingBars']} | {f(t['return'])} | {m(t['pnl'])} |")
lines+=['','截至样本末日，逐日观察策略有一个待次日执行的B状态变化，因为没有9月10日数据，未计入交易。','',
'## 数据与验证','',
'- 行情来源：东方财富日线API，512890和H30269，klt=101；2022-01-01至2026-09-09；fqt=0。另用512890的fqt=1逐日OHLC对照。',
'- 数据快照：512890-extended.json、512890-adjusted.json、h30269-extended.json。',
'- 基金分红及拆分核对页面：https://fundf10.eastmoney.com/fhsp_512890.html（列示2021-10-22份额拆分1:2）。网页显示的信息不能替代官方公告；本回测对样本内处理的主要检验是两种复权口径OHLC完全一致。',
'- 已校验OHLC有效、日期升序无重复；B/S提取与项目calculateWaveSignals在多个历史截面完全一致；成交晚于信号日；现金与份额非负；账户盈亏与逐笔加期末浮盈核对一致。',
'- 日线回放不是逐笔或盘中回放，不能还原当天盘中出现后又消失的信号；没有模拟成交失败、盘口深度或临时停牌。',
'- 三份数据统一截止2026-09-09，文件冻结后运行；未修改项目行情文件。',
'- 复现：在仓库根目录运行 `node artifacts/bs-backtest-20260909/backtest.mjs`。图表与本报告：`python artifacts/bs-backtest-20260909/make_report.py`。',
'- 原始数值在summary.json，各口径逐笔和每日净值在对应*-details.json。','',
'判读：本样本默认参数下，逐日观察口径并不是高胜率策略；盈利主要依靠平均盈利交易大于平均亏损交易。其收益低于买入持有，最大回撤改善有限。最终历史图的优异结果不能外推到实时交易。']
(p/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Report and equity chart created')
