import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const dir=new URL('./',import.meta.url)
const load=n=>JSON.parse(readFileSync(new URL(n,dir),'utf8'))
const history=load('512890-extended.json').history, observations=load('combined-signals.json').observations,prior=load('sell-comparison-summary.json')
assert.equal(createHash('sha256').update(JSON.stringify(history)).digest('hex'),prior.assumptions.sha256)
assert.equal(createHash('sha256').update(readFileSync(new URL('../../src/utils/waveSignals.js',dir))).digest('hex'),prior.assumptions.formulaSHA256)
function simulate(h,obs,{mode='half',fee=.0001,slip=.0005,start=0}={}){
 const initial=100000,commission=value=>Math.max(fee?5:0,value*fee)
 let cash=initial,shares=0,entry=null,peak=initial,peakDate=h[start].date,maxDD=0,ddPeak=null,ddTrough=null,totalFees=0,totalSlippage=0,exposed=0,weighted=0,previous=initial
 const trades=[],equity=[],annual={},legs=[]
 for(let i=start;i<h.length;i++){
  const p=h[i],signal=i>start?obs[i-1]:null,buys=signal?.buys??[],sells=(signal?.sells??[]).filter(e=>mode!=='sOnly'||e.name==='转向卖')
  const hasS=sells.some(e=>e.name==='转向卖'),hasWave=sells.some(e=>e.name==='波段卖')
  if(shares&&sells.length){
   const full=hasS||mode==='original'
   const qty=full?shares:mode==='half'&&hasWave&&!entry.reduced?Math.floor(shares/200)*100:0
   if(qty){
    const price=p.open*(1-slip),gross=qty*price,cost=commission(gross),proceeds=gross-cost
    cash+=proceeds;shares-=qty;totalFees+=cost;totalSlippage+=qty*p.open*slip
    const leg={signalDate:h[i-1].date,date:p.date,index:i,shares:qty,open:p.open,fill:price,commission:cost,proceeds,reason:full?'清仓':'减半',signals:sells,return:proceeds/(entry.cost*qty/entry.shares)-1}
    entry.exits.push(leg);legs.push(leg)
    if(!full)entry.reduced=true
    if(!shares){
     const pnl=entry.exits.reduce((v,e)=>v+e.proceeds,0)-entry.cost
     trades.push({...entry,sellDate:p.date,sellSignalDate:h[i-1].date,sellIndex:i,pnl,return:pnl/entry.cost,holdingBars:i-entry.buyIndex,holdingDays:(Date.parse(p.date)-Date.parse(entry.buyDate))/86400000})
     entry=null
    }
   }
  }else if(!shares&&!sells.length&&buys.length){
   const price=p.open*(1+slip)
   let qty=Math.floor(cash/(price*(1+fee))/100)*100
   while(qty>0&&qty*price+commission(qty*price)>cash)qty-=100
   if(qty){const cost=commission(qty*price),outlay=qty*price+cost
    cash-=outlay;shares=qty;totalFees+=cost;totalSlippage+=qty*p.open*slip
    entry={signalDate:h[i-1].date,buyDate:p.date,buyIndex:i,buyOpen:p.open,buyFill:price,shares:qty,cost:outlay,buyCommission:cost,buySignals:buys,reduced:false,exits:[]}
   }
  }
  const nav=cash+shares*p.close
  if(shares)exposed++
  weighted+=shares*p.close/nav
  if(nav>peak){peak=nav;peakDate=p.date}
  const dd=nav/peak-1
  if(dd<maxDD){maxDD=dd;ddPeak=peakDate;ddTrough=p.date}
  const year=p.date.slice(0,4)
  if(!annual[year])annual[year]={start:previous,end:nav}
  annual[year].end=nav;previous=nav
  equity.push({date:p.date,equity:nav,cash,shares,drawdown:dd,positionWeight:shares*p.close/nav})
 }
 const finalEquity=equity.at(-1).equity,n=trades.length,wins=trades.filter(t=>t.pnl>1e-8),losses=trades.filter(t=>t.pnl< -1e-8),avg=a=>a.length?a.reduce((v,t)=>v+t.return,0)/a.length:null,sum=a=>a.reduce((v,t)=>v+t.pnl,0)
 const years=(Date.parse(h.at(-1).date)-Date.parse(h[start].date))/86400000/365.25
 const open=entry?{...entry,remainingShares:shares,lastClose:h.at(-1).close,totalPnl:entry.exits.reduce((v,e)=>v+e.proceeds,0)+shares*h.at(-1).close-entry.cost}:null
 const summary={mode,start:h[start].date,end:h.at(-1).date,bars:h.length-start,initial,finalEquity,totalReturn:finalEquity/initial-1,cagr:(finalEquity/initial)**(1/years)-1,maxDD,ddPeak,ddTrough,trades:n,wins:wins.length,losses:losses.length,winRate:n?wins.length/n:null,avgTrade:avg(trades),avgWin:avg(wins),avgLoss:avg(losses),profitFactor:losses.length?sum(wins)/-sum(losses):null,bestTrade:n?Math.max(...trades.map(t=>t.return)):null,worstTrade:n?Math.min(...trades.map(t=>t.return)):null,avgHoldingBars:n?trades.reduce((v,t)=>v+t.holdingBars,0)/n:null,maxHoldingBars:n?Math.max(...trades.map(t=>t.holdingBars)):null,exposure:exposed/(h.length-start),averagePositionWeight:weighted/(h.length-start),totalFees,totalSlippage,partialExits:legs.filter(e=>e.reason==='减半').length,sellOrders:legs.length,openPosition:open,annual:Object.fromEntries(Object.entries(annual).map(([year,v])=>[year,v.end/v.start-1]))}
 assert.ok(equity.every(e=>e.cash>=-1e-6&&e.shares>=0&&e.shares%100===0))
 for(const t of trades){assert.ok(t.buyDate>t.signalDate);assert.equal(t.exits.reduce((v,e)=>v+e.shares,0),t.shares);assert.ok(t.exits.every(e=>e.date>e.signalDate));assert.ok(t.exits.filter(e=>e.reason==='减半').length<=1)}
 assert.ok(Math.abs(finalEquity-initial-sum(trades)-(open?.totalPnl??0))<1e-6)
 return {summary,trades,legs,equity}
}
const results=Object.fromEntries(['original','sOnly','half'].map(mode=>[mode,simulate(history,observations,{mode})]))
for(const [mode,key] of [['original','current'],['sOnly','onlyS']])for(const field of ['finalEquity','maxDD','winRate','trades'])assert.ok(Math.abs(results[mode].summary[field]-prior[key][field])<1e-8)
const h=Array.from({length:8},(_,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,open:1,close:1}))
const ob=(b=false,w=false,s=false)=>({buys:b?[{name:'共振买点'}]:[],sells:[...(w?[{name:'波段卖'}]:[]),...(s?[{name:'转向卖'}]:[])]})
const synthetic=simulate(h,[ob(true),ob(false,true),ob(false,true),ob(true),ob(),ob(false,true,true),ob(true,true),ob()],{fee:0,slip:0})
assert.equal(synthetic.trades.length,1);assert.equal(synthetic.trades[0].exits.length,2);assert.equal(synthetic.equity[2].shares,50000);assert.equal(synthetic.equity[4].shares,50000);assert.equal(synthetic.equity[6].shares,0);assert.equal(synthetic.equity[7].shares,0)
const windows=['2023-01-01','2024-01-01','2025-01-01'].map(date=>{const start=history.findIndex(p=>p.date>=date);return {start:history[start].date,...Object.fromEntries(['original','sOnly','half'].map(mode=>[mode,simulate(history,observations,{mode,start}).summary]))}})
const halfNoCost=simulate(history,observations,{fee:0,slip:0})
const output={assumptions:{...prior.assumptions,rule:'红线或B买入；首个波段卖减半一次（100份取整）；S清仓；不加回；同日S优先'},results:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.summary])),buyHold:prior.buyHold,halfNoCost:halfNoCost.summary,windows}
writeFileSync(new URL('partial-exit-summary.json',dir),JSON.stringify(output,null,2))
for(const [key,v] of Object.entries(results))writeFileSync(new URL(`partial-exit-${key}-details.json`,dir),JSON.stringify(v,null,2))
console.log(JSON.stringify({results:output.results,halfNoCost:halfNoCost.summary.totalReturn,trades:results.half.trades.map(t=>({buy:t.buyDate,exits:t.exits.map(e=>({date:e.date,type:e.reason,return:e.return})),return:t.return}))},null,2))
