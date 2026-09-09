import json
from pathlib import Path
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
p=Path('artifacts/bs-backtest-20260909').resolve()
load=lambda n:json.loads((p/n).read_text(encoding='utf-8'))
s=load('sell-comparison-summary.json');d=load('sell-only-s-details.json')
f=lambda x:'—' if x is None else f'{x*100:.2f}%'
m=lambda x:f'{x:,.2f}'
s['candidateRule']='买入仍为共振红线或B首次出现；卖出仅S首次出现，完全忽略波段卖；其余规则不变'
(p/'sell-comparison-summary.json').write_text(json.dumps(s,ensure_ascii=False,indent=2),encoding='utf-8')
plt.rcParams['font.sans-serif']=['Microsoft YaHei','DejaVu Sans'];plt.rcParams['axes.unicode_minus']=False
fig,ax=plt.subplots(figsize=(11,5))
for data,label,color in [(load('combined-details.json'),'原版：波段卖或S','#c89845'),(d,'候选版：只按S卖出','#287bb3'),(load('buyHold-details.json'),'买入持有','#40a080')]:
 ax.plot([datetime.fromisoformat(e['date']) for e in data['equity']],[e['equity']/10000 for e in data['equity']],label=label,color=color,lw=1.4)
ax.set_title('512890｜只改变卖出条件的对照回测',loc='left',fontsize=15);ax.set_ylabel('账户权益（万元）');ax.legend(frameon=False);ax.grid(alpha=.2);ax.spines[['top','right']].set_visible(False)
fig.text(.07,.02,'2022-01-04—2026-09-09；同一逐日信号记录；初始10万元；次日开盘成交，计佣金和滑点。',fontsize=9)
fig.tight_layout(rect=[0,.05,1,1]);fig.savefig(p/'sell-comparison.png',dpi=150);plt.close(fig)
lines=['# 卖出条件对照：波段卖或S vs 仅S','',
'**结论：本样本只按S卖出，总收益从22.71%增至34.71%，但回撤从9.92%增至12.11%，最差单笔从−4.09%恶化至−11.68%。收益改善伴随更长持仓、更高市场暴露和更大的单笔亏损，不能视为无条件改善。**','',
'## 控制变量','',
'- 同为512890日线，2022-01-04—2026-09-09，共1,136根。',
'- 同一套从历史截面逐日生成、首次出现即记录的信号账本。共振红线或B为买入条件，消失不触发交易。',
'- 原版：波段卖或S卖出。候选版：仅S卖出，波段卖完全忽略，包括空仓时也不阻止新买点。',
'- 初始10万元，全仓/清仓，100份整数交易；单边佣金万一最低5元、单边滑点万五；次日开盘成交，现金不计息。',
'- 实际买入日期不保证完全一致：候选版未卖出时，后续买点被忽略，这是只改变卖出规则的自然结果。',
'- 数据与公式哈希均核对一致；重跑原版的完整汇总与先前结果精确一致。','',
'## 汇总','', '| 指标 | 原版 | 只按S | 买入持有 |','|---|---:|---:|---:|']
for label,key,fmt in [('期末资金（元）','finalEquity',m),('累计收益','totalReturn',f),('年化收益','cagr',f),('最大回撤','maxDD',f),('完整交易','trades',str),('盈利笔数','wins',str),('亏损笔数','losses',str),('胜率','winRate',f),('平均持仓交易日','avgHoldingBars',lambda x:'—' if x is None else f'{x:.1f}'),('持仓时间比例','exposure',f),('最差单笔','worstTrade',f),('最佳单笔','bestTrade',f)]:
 lines.append('| '+label+' | '+' | '.join(fmt(s[k][key]) for k in ['current','onlyS','buyHold'])+' |')
lines+=['','两策略期末均空仓，买入持有期末仍持仓，所以基准胜率不适用。最大回撤按日末权益计算。','',f'![权益对比]({(p/"sell-comparison.png").as_posix()})','',
'## 年度收益','', '| 年份 | 原版 | 只按S | 买入持有 |','|---|---:|---:|---:|']
for year in s['current']['annual']:lines.append('| '+year+' | '+' | '.join(f(s[k]['annual'][year]) for k in ['current','onlyS','buyHold'])+' |')
lines+=['','2026年为截至9月9日。年度收益包括跨年度浮动盈亏。','',
'## 相同买入日期的逐笔对照','',
'这些是各自实际路径中的同日起买交易，按单笔净收益率对照。不能把差额相加当作账户总收益差，因为仓位资金、复利和后续买入机会不同。','',
'| 买入日 | 原版卖出日 | 原版净收益 | 只按S卖出日 | 只按S净收益 | 额外持仓交易日 |','|---|---|---:|---|---:|---:|']
for t in s['sameEntries']:lines.append(f"| {t['buyDate']} | {t['originalExit']} | {f(t['originalReturn'])} | {t['newExit']} | {f(t['newReturn'])} | {t['extraHoldingBars']} |")
lines+=['','原版另有4次买入：'+ '、'.join(s['oldEntryDatesNotTaken'])+'。候选版在这些日期仍持有此前仓位，因而没有再买入。','',
'## 只按S的全部11笔交易','',
'价格为原始开盘价，净收益已扣滑点与佣金。所有卖出触发都是首次观察到的新S。','',
'| # | 买点首次观察日 | 买入日 | 买入触发 | 买入开盘 | S首次观察日 | 卖出日 | 卖出开盘 | 持仓交易日 | 净收益 | 净盈亏（元） |','|---:|---|---|---|---:|---|---|---:|---:|---:|---:|']
for i,t in enumerate(d['trades'],1):
 names='＋'.join('红线' if e['name']=='共振买点' else 'B' for e in t['buySignals'])
 lines.append(f"| {i} | {t['signalDate']} | {t['buyDate']} | {names} | {t['buyOpen']:.3f} | {t['sellSignalDate']} | {t['sellDate']} | {t['sellOpen']:.3f} | {t['holdingBars']} | {f(t['return'])} | {m(t['pnl'])} |")
lines+=['','## 不同起始日期检验','',
'这些是空仓重新起步的重叠子区间，信号仍用2022年以来的历史初始化；不是独立样本外测试。','',
'| 起始日 | 原版总收益 | 只按S总收益 | 原版最大回撤 | 只按S最大回撤 |','|---|---:|---:|---:|---:|']
for w in s['windows']:lines.append(f"| {w['start']} | {f(w['current']['totalReturn'])} | {f(w['onlyS']['totalReturn'])} | {f(w['current']['maxDD'])} | {f(w['onlyS']['maxDD'])} |")
lines+=['','## 判断和限制','',
'- 只按S在本样本的收益和胜率较高，但平均持仓从21.8增至61.5个交易日，持仓暴露由28.79%增至59.51%；不能把更高收益全部归因于预测更准确。',
'- 2022-02-11这一笔，原版亏2.01%离场，只按S亏11.68%离场。较早的波段卖在这里发挥了保护作用。',
'- 2026-01-12这一笔，原版3月19日净赚3.32%卖出；只按S要等到7月27日，净亏0.21%。候选版因此也没有参与6月24日那次独立买入。',
'- 本次只验证了一种改动，没有验证分批卖出、止损或新的买入确认，不据此直接修改网站默认策略。',
'- 本样本已经被反复研究，结果是探索性对照；需要冻结规则后在新数据上验证，不是未来收益承诺。',
'- 日线收盘回放无法还原盘中出现后又消失的信号，不能代表盘中实时成交策略。','',
'复现：`node artifacts/bs-backtest-20260909/backtest-sell-comparison.mjs`。结果：sell-comparison-summary.json、sell-only-s-details.json。']
(p/'sell-comparison-report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Report saved')
