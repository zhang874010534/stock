import json
from pathlib import Path
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

p = Path(__file__).resolve().parent
load = lambda n: json.loads((p/n).read_text(encoding='utf-8'))
s = load('partial-exit-summary.json')
d = load('partial-exit-half-details.json')
f = lambda x: '—' if x is None else f'{x*100:.2f}%'
m = lambda x: f'{x:,.2f}'
names = {'共振买点':'红线', '转向买':'B', '波段卖':'波段卖', '转向卖':'S'}
events = lambda es: '；'.join(f"{names[e['name']]}（标记{e['markerDate']}，观察{e['observedDate']}）" for e in es)
plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
fig, ax = plt.subplots(figsize=(11,5))
for file, label in [('partial-exit-original-details.json','原版：波段卖或S清仓'),('partial-exit-half-details.json','波段卖减半、S清仓'),('partial-exit-sOnly-details.json','只按S清仓'),('buyHold-details.json','买入持有')]:
    eq = load(file)['equity']
    ax.plot([datetime.fromisoformat(e['date']) for e in eq], [e['equity']/10000 for e in eq], label=label, lw=1.4)
ax.set_title('512890｜分批卖出对照回测', loc='left', fontsize=15)
ax.set_ylabel('账户权益（万元）')
ax.legend(frameon=False)
ax.grid(alpha=.2)
ax.spines[['top','right']].set_visible(False)
fig.text(.07,.02,'2022-01-04—2026-09-09；初始10万元；逐日观察信号，次日开盘成交；计佣金与滑点。',fontsize=9)
fig.tight_layout(rect=[0,.05,1,1])
fig.savefig(p/'partial-exit.png',dpi=150)
plt.close(fig)
lines = ['# 512890：波段卖减半、S清仓对照回测','',
'结果：分批卖出累计收益24.77%，最大回撤9.92%。比原版多赚2,057.97元，但比只按S少赚9,946.92元。属于风险收益折中，尚不能认定为稳定优于原版。','',
'## 规则与数据','',
'- 2022-01-04至2026-09-09，共1,136根日线，使用此前保存的同一数据快照与项目默认公式（ZIG 10%，sellPeriod 3）。',
'- 空仓时首次观察到共振买点红线或B，全仓买入。持仓时首次波段卖减半一次，之后忽略重复波段卖；S清仓。减半后不加回；剩余仓位未清仓时忽略新买点。',
'- 同日S与波段卖出现，直接清仓。空仓时买卖信号同时出现，不买入。卖出份额按100份向下取整，因此减半可能略少于50%。',
'- 逐日只使用截至当天的数据，按标记日期和信号类型记录首次观察；信号消失不撤销交易，旧信号再次出现不重复交易。后补历史标记只在观察当天响应。',
'- 收盘观察，下一交易日开盘成交；初始10万元；单边佣金万一、最低5元；单边滑点万五；现金不计息。',
'- 该区间原始与前复权OHLC相同；没有另加现金分红。期末按收盘估值，不强制清仓。三种策略期末均空仓。','',
'## 汇总','', '| 指标 | 原版 | 波段卖减半、S清仓 | 只按S |','|---|---:|---:|---:|']
for label,key,fmt in [('期末资金（元）','finalEquity',m),('总收益','totalReturn',f),('年化收益','cagr',f),('最大回撤','maxDD',f),('完整交易笔数','trades',str),('盈利笔数','wins',str),('亏损笔数','losses',str),('胜率','winRate',f),('最差单笔','worstTrade',f),('最佳单笔','bestTrade',f),('平均持仓交易日','avgHoldingBars',lambda x:f'{x:.1f}'),('持仓时间占比','exposure',f),('平均股票仓位','averagePositionWeight',f),('佣金合计（元）','totalFees',m),('卖出订单数','sellOrders',str)]:
    lines.append('| '+label+' | '+' | '.join(fmt(s['results'][k][key]) for k in ['original','half','sOnly'])+' |')
lines += ['', '胜率按一次买入到最终清仓的完整交易计算，不能把减半和清仓分别统计。分批版11笔交易含9次减半，共20笔卖单。持仓时间包括半仓期间；平均仓位按每日持仓市值占账户权益计算。', '',
'买入持有对照：总收益52.23%，年化9.40%，最大回撤14.16%。', '',f'![权益曲线]({(p/"partial-exit.png").as_posix()})','',
'## 年度收益','', '| 年度 | 原版 | 分批版 | 只按S |','|---|---:|---:|---:|']
for y in s['results']['half']['annual']:
    lines.append('| '+y+' | '+' | '.join(f(s['results'][k]['annual'][y]) for k in ['original','half','sOnly'])+' |')
lines += ['', '2026年截至9月9日；年度收益包括跨年持仓的浮动盈亏。','',
'## 全部完整交易','', '| # | 买入日 | 减半日 | 清仓日 | 持仓交易日 | 整笔净收益 | 净盈亏（元） |','|---:|---|---|---|---:|---:|---:|']
for i,t in enumerate(d['trades'],1):
    half = next((e['date'] for e in t['exits'] if e['reason']=='减半'),'—')
    lines.append(f"| {i} | {t['buyDate']} | {half} | {t['sellDate']} | {t['holdingBars']} | {f(t['return'])} | {m(t['pnl'])} |")
lines += ['', '## 每笔信号与成交明细','', '价格为计入滑点的实际模拟成交价；每个信号均列出图上标记日与实际观察日。','',
'| 交易 | 操作 | 信号 | 成交日 | 份额 | 成交价 | 佣金（元） |','|---:|---|---|---|---:|---:|---:|']
for i,t in enumerate(d['trades'],1):
    lines.append(f"| {i} | 买入 | {events(t['buySignals'])} | {t['buyDate']} | {t['shares']} | {t['buyFill']:.6f} | {m(t['buyCommission'])} |")
    for e in t['exits']:
        lines.append(f"| {i} | {e['reason']} | {events(e['signals'])} | {e['date']} | {e['shares']} | {e['fill']:.6f} | {m(e['commission'])} |")
lines += ['', '## 关键解释与验证','',
'- 2026-01-12买入：3月19日减半，7月27日清仓，整笔赚1.56%。原版这笔3月19日清仓赚3.32%；只按S整笔亏0.21%。分批版6月24日仍持有半仓，不能把那次买点再算成一笔买入。',
'- 2022-02-11买入：原版亏2.01%，分批版亏6.85%，只按S亏11.68%。减半降低了延迟退出的损失，但保护力度弱于直接清仓。',
'- 分批版最大回撤9.9236%，原版9.9180%，四舍五入均为9.92%；并没有降低本样本最大回撤。分批版最差单笔也比原版更差。',
'- 引擎重跑原版及只按S，期末权益、回撤、胜率与交易笔数均与此前结果一致；验证资金与100份整数约束、卖出数量守恒、交易先观察后成交；合成案例覆盖重复减半、持仓不加回及同日信号冲突。',
'- 本样本反复用于策略探索，尚无独立样本外验证。只有11笔完整交易，胜率不能直接外推。没有修改网站默认策略。',
'- 日线收盘回放无法还原盘中出现后又消失的信号。', '',
'复现：`node artifacts/bs-backtest-20260909/backtest-partial-exit.mjs`。原始明细：partial-exit-half-details.json；汇总与子区间结果：partial-exit-summary.json。']
(p/'partial-exit-report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(p/'partial-exit-report.md')
