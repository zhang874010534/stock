import json
from pathlib import Path
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
p=Path(__file__).resolve().parent
s=json.loads((p/'first-appearance-summary.json').read_text())
d=json.loads((p/'first-appearance-details.json').read_text())
b=json.loads((p/'buyHold-details.json').read_text())
h=json.loads((p/'512890-extended.json').read_text())['history']
f=lambda x:'—' if x is None else f'{x*100:.2f}%'
m=lambda x:f'{x:,.2f}'
a=s['main'];bh=s['buyHold']
plt.rcParams['font.sans-serif']=['Microsoft YaHei','DejaVu Sans'];plt.rcParams['axes.unicode_minus']=False
fig,axes=plt.subplots(2,1,figsize=(11,6.5),sharex=True,gridspec_kw={'height_ratios':[3,1]})
for data,label,color in [(d,'首次出现B买、首次出现S卖；消失不操作','#287bb3'),(b,'买入持有','#40a080')]:
 dates=[datetime.fromisoformat(e['date']) for e in data['equity']]
 axes[0].plot(dates,[e['equity']/10000 for e in data['equity']],color=color,label=label,lw=1.6)
 axes[1].plot(dates,[e['drawdown']*100 for e in data['equity']],color=color,lw=1)
axes[0].set_title('512890｜按首次实际出现的 B/S 执行，忽略信号消失',loc='left',fontsize=14,pad=15)
axes[0].legend(frameon=False,loc='upper left');axes[0].set_ylabel('账户权益（万元）');axes[1].set_ylabel('回撤（%）')
for ax in axes:
 ax.grid(alpha=.2);ax.spines[['top','right']].set_visible(False)
axes[1].xaxis.set_major_locator(mdates.YearLocator());axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
fig.text(.07,.015,'2022-01-04—2026-09-09；次日开盘；单边万一佣金（最低5元）＋万五滑点；仅日线收盘回放。',fontsize=9,color='#555')
fig.tight_layout(rect=[0,.045,1,1]);fig.savefig(p/'first-appearance-equity.png',dpi=150);plt.close(fig)
lines=['# B/S 首次出现即执行：修订回测','',
'本报告采用用户明确后的规则，取代此前用“图上最新B/S状态变化”模拟交易的口径。信号的消失不触发任何买卖；既有交易不随历史图重绘而修改。','',
'**结果：2022-01-04至2026-09-09，512890默认ZIG=10%，5笔完整交易全部盈利；扣费用后累计收益36.61%，最大回撤12.02%，期末空仓。2026年在7月27日已经卖出，并非从7月2日一直持有。**','',
'## 交易规则','',
'1. 每日收盘仅输入截至当日的行情，重新计算项目真实B/S公式，扫描当时实际显示的全部B/S。',
'2. 以“标记所在K线日期＋B或S”识别一个信号，首次看到时写入不可撤销的观察记录；即使标记回填到较早K线，也只从实际观察当天开始处理。',
'3. 空仓遇到新的B：下一交易日开盘全仓买入；持仓遇到新的S：下一交易日开盘清仓。',
'4. 买入后的B消失：继续持有。卖出后的S消失：继续空仓。图上重新以旧B作为最后一个标记，不视为新的B。',
'5. 持仓期间重复B不加仓；空仓期间S不操作。没有止损、止盈、持仓超时或信号消失平仓规则。',
'6. 同一个标记消失后重新出现，主结果不重复触发；另测“重新出现也算一次”，本样本结果完全相同，新增记录数同为45。',
'7. 若同日首次出现B和S两种标记，预设取位置最靠右的新标记。本样本没有这种冲突。',
'8. 初始10万元，100份整数交易；单边佣金万一、最低5元，另计万五滑点；现金不计息。期末持仓不强平。','',
'## 汇总','', '| 指标 | 本次明确后的规则 | 买入持有 |','|---|---:|---:|']
for label,key,fmt in [('期末权益（元）','finalEquity',m),('累计收益','totalReturn',f),('年化收益','cagr',f),('收盘净值最大回撤','maxDD',f),('已平仓交易','trades',str),('盈利笔数','wins',str),('亏损笔数','losses',str),('胜率','winRate',f),('持仓日比例','exposure',f)]:
 lines.append(f'| {label} | {fmt(a[key])} | {fmt(bh[key])} |')
lines+=['','买入持有期末仍持仓，完整交易数为0，胜率不适用。策略不计费用时累计收益37.43%；成本扣除后36.61%。',
f"累计佣金{m(a['totalFees'])}元，累计滑点金额{m(a['totalSlippage'])}元；本金复利及整数交易使得成本金额之和不直接等于最终收益差。",'',
f"![修订回测净值]({(p/'first-appearance-equity.png').as_posix()})",'',
'## 全部5笔交易','',
'信号日为实际观察日期。表中价格是原始开盘价，成交另加减滑点；净收益已扣佣金与滑点。','',
'| # | 首次看到B | 买入日 | 买入开盘 | 首次看到S | 卖出日 | 卖出开盘 | 持仓交易日 | 净收益 | 净盈亏（元） |','|---:|---|---|---:|---|---|---:|---:|---:|---:|']
for i,t in enumerate(d['trades'],1):
 lines.append(f"| {i} | {t['signalDate']} | {t['buyDate']} | {t['buyOpen']:.3f} | {t['sellSignalDate']} | {t['sellDate']} | {t['sellOpen']:.3f} | {t['holdingBars']} | {f(t['return'])} | {m(t['pnl'])} |")
lines+=['',
'## 2026年信号消失时怎么处理','',
'| 日期 | 当时观察到的事件 | 策略动作 |','|---|---|---|',
'| 2026-06-23 | B首次出现 | 安排次日买入 |',
'| 2026-06-24 | 开盘买入；收盘后6月23日的B已经消失 | 保留持仓，不因B消失卖出 |',
'| 2026-06-29 | 又有B出现 | 已持仓，不重复买入 |',
'| 2026-06-30 | 6月29日的B消失 | 仍持有 |',
'| 2026-07-01 | 又有B出现 | 已持仓，不在7月2日重新买入 |',
'| 2026-07-24 | S首次出现 | 安排下一交易日卖出 |',
'| 2026-07-27 | 开盘价1.161卖出 | 这笔已平仓，净收益3.72% |',
'| 2026-07-28 | 7月24日的S消失 | 不撤销卖出，不因旧B露出而买回 |',
'| 2026-07-31、09-02 | 又有S出现 | 已空仓，无操作 |',
'| 截至2026-09-09 | 没有新的可买入B | 保持空仓 |','',
'信号消失日期使用各日历史截面逐日复算核对，未使用最终图倒推成交。','',
'## 年度收益','', '| 年份 | 本次规则 | 买入持有 |','|---|---:|---:|']
for y,v in a['annual'].items():lines.append(f'| {y} | {f(v)} | {f(bh["annual"][y])} |')
lines+=['','2026为截至9月9日。2023年的年度收益为负与最终5笔全部盈利不矛盾：2023年末有未平仓浮亏，之后到2024年才盈利卖出。','',
'## 样本限制与信号含义','',
'- 5/5是本段历史样本的结果，不是未来100%胜率。粗略二项Wilson 95%区间约56.55%—100%，且该区间还依赖交易独立的近似。',
'- 其中一笔持有181个交易日。平仓盈利不代表持有过程不亏；策略收盘净值仍曾回撤12.02%。',
'- 本次收益36.61%，低于买入持有52.23%，年化分别6.89%和9.40%；仓位暴露分别22.18%和100%，未给空仓资金添加利息收益。',
'- 这次是日线收盘信号回放，不能还原盘中曾短暂出现、收盘前消失的B/S。若要求盘中看到立即交易，需要历史分钟或逐笔行情及相同的盘中计算逻辑。',
'- 为保持与上次比较，沿用冻结的2022年以来1,136根ETF日线及费用假设。不是从上市以来测试，也未更换为当前网页可能加载的较短历史。','',
'## 参数对比（相同首次出现规则，样本内探索）','',
'| ZIG | 完整交易 | 盈利/亏损 | 胜率 | 总收益 | 最大回撤 |','|---|---:|---:|---:|---:|---:|']
for q in s['sensitivity']:lines.append(f"| {q['percent']}% | {q['trades']} | {q['wins']}/{q['losses']} | {f(q['winRate'])} | {f(q['totalReturn'])} | {f(q['maxDD'])} |")
lines+=['','未因12%样本内较好而调整默认参数，以上不构成样本外证明。','',
'## 与上次数字的对应','',
'- 上次“4笔100%、收益156.87%”：最终历史图交易，包含前视，不符合本次规则。',
'- 上次“39笔、胜率43.59%”：把最新标记类型变化也当成交易信号，包含S消失后旧B重新成为最新标记导致的买入，不符合本次规则。',
'- 上次报告另列的“只接受当天K线信号”5笔结果，与本次完整扫描首次出现结果恰好一致；本次验证了较早K线上新增标记及重新出现处理，没有直接假设二者等价。','',
'## 复现与文件','',
'- 运行：`node artifacts/bs-backtest-20260909/backtest-first-appearance.mjs`。',
'- 全部观察记录：first-appearance-signals.json；每条包含观察日期、标记日期、类型和延迟交易日数。',
'- 每日净值、全部成交：first-appearance-details.json；汇总：first-appearance-summary.json。',
'- 原始数据和OHLC复权校验沿用上一份报告。',
'- 已核对多个历史截面的B/S与项目完整指标一致、信号之后才成交、权益与逐笔盈亏一致、现金与份额非负。',
'- 本次未修改网站指标或实际交易功能，仅生成研究结果。']
(p/'first-appearance-report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Created revised report')
