import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { zigzag, calculateWaveSignals } from '../../src/utils/waveSignals.js'
import { validateHistory } from '../../scripts/lib/market-data.mjs'
const dir = new URL('./', import.meta.url)
const load = name => JSON.parse(readFileSync(new URL(name, dir),'utf8')).history
const source = load('512890-extended.json')
validateHistory(source)
const adjusted = load('512890-adjusted.json')
assert.deepEqual(source.map(p=>[p.date,p.open,p.close,p.high,p.low]),adjusted.map(p=>[p.date,p.open,p.close,p.high,p.low]))
const initial=100000
function signals(closes, percent=10) {
  const z=zigzag(closes,percent).values
  return z.map((v,i)=>i<2?null:v>z[i-1]&&z[i-1]<=z[i-2]?'B':v<z[i-1]&&z[i-1]>=z[i-2]?'S':null)
}
function signalSets(h,percent=10){
  const c=h.map(p=>p.close), final=signals(c,percent), live=c.map((_,i)=>signals(c.slice(0,i+1),percent).at(-1))
  let previous=null
  const observed=c.map((_,i)=>{
    const list=signals(c.slice(0,i+1),percent), at=list.findLastIndex(Boolean)
    const current=at<0?null:list[at]
    const out=current&&current!==previous?list[at]:null
    previous=current
    return out
  })
  return {final,live,observed}
}
function run(h,sig,{fee=.0001,slip=.0005,lot=100,start=0,buyHold=false}={}){
  let cash=initial,shares=0,entry=null,peak=initial,peakDate=h[start].date,maxDD=0,ddPeak=null,ddTrough=null,exposure=0,totalFees=0,totalSlippage=0
  const trades=[],equity=[]
  let previousEquity=initial
  const annual={}
  for(let i=start;i<h.length;i++){
    const p=h[i],signal=buyHold?(i===start?'B':null):i>start?sig[i-1]:null
    if(signal==='B'&&!shares){
      const price=p.open*(1+slip)
      shares=Math.floor(cash/(price*(1+fee))/lot)*lot
      while(shares>0&&shares*price+Math.max(fee?5:0,shares*price*fee)>cash)shares-=lot
      if(shares){const commission=Math.max(fee?5:0,shares*price*fee),cost=shares*price+commission
        cash-=cost;totalFees+=commission;totalSlippage+=shares*p.open*slip
        entry={signalDate:buyHold?p.date:h[i-1].date,buyDate:p.date,buyIndex:i,buyOpen:p.open,buyFill:price,shares,cost,buyFee:commission}
      }
    }else if(signal==='S'&&shares){
      const price=p.open*(1-slip),commission=Math.max(fee?5:0,shares*price*fee),proceeds=shares*price-commission,pnl=proceeds-entry.cost
      cash+=proceeds;totalFees+=commission;totalSlippage+=shares*p.open*slip
      trades.push({...entry,sellSignalDate:h[i-1].date,sellDate:p.date,sellIndex:i,sellOpen:p.open,sellFill:price,sellFee:commission,pnl,return:pnl/entry.cost,holdingBars:i-entry.buyIndex,holdingDays:(Date.parse(p.date)-Date.parse(entry.buyDate))/86400000})
      shares=0;entry=null
    }
    const nav=cash+shares*p.close
    if(shares)exposure++
    if(nav>peak){peak=nav;peakDate=p.date}
    const dd=nav/peak-1
    if(dd<maxDD){maxDD=dd;ddPeak=peakDate;ddTrough=p.date}
    const year=p.date.slice(0,4)
    if(!annual[year])annual[year]={startEquity:previousEquity,endEquity:nav}
    annual[year].endEquity=nav;previousEquity=nav
    equity.push({date:p.date,equity:nav,cash,shares,drawdown:dd,signal:sig[i]??null})
  }
  const wins=trades.filter(t=>t.pnl>1e-8),losses=trades.filter(t=>t.pnl< -1e-8),n=trades.length,wr=n?wins.length/n:null,z=1.96
  const center=n?(wr+z*z/(2*n))/(1+z*z/n):null,half=n?z*Math.sqrt(wr*(1-wr)/n+z*z/(4*n*n))/(1+z*z/n):null
  const sum=a=>a.reduce((s,t)=>s+t.pnl,0),avg=a=>a.length?a.reduce((s,t)=>s+t.return,0)/a.length:null
  const finalEquity=equity.at(-1)?.equity??initial,years=(Date.parse(h.at(-1).date)-Date.parse(h[start].date))/86400000/365.25
  const open=entry?{...entry,lastDate:h.at(-1).date,lastClose:h.at(-1).close,pnl:shares*h.at(-1).close-entry.cost,return:(shares*h.at(-1).close-entry.cost)/entry.cost}:null
  return {summary:{start:h[start].date,end:h.at(-1).date,bars:h.length-start,initial,finalEquity,totalReturn:finalEquity/initial-1,cagr:(finalEquity/initial)**(1/years)-1,maxDD,ddPeak,ddTrough,trades:n,wins:wins.length,losses:losses.length,flat:n-wins.length-losses.length,winRate:wr,winRateWilson95:n?[center-half,center+half]:null,avgTrade:avg(trades),avgWin:avg(wins),avgLoss:avg(losses),payoffRatio:losses.length&&wins.length?avg(wins)/-avg(losses):null,profitFactor:losses.length?sum(wins)/-sum(losses):null,bestTrade:n?Math.max(...trades.map(t=>t.return)):null,worstTrade:n?Math.min(...trades.map(t=>t.return)):null,avgHoldingBars:n?trades.reduce((s,t)=>s+t.holdingBars,0)/n:null,exposure:exposure/(h.length-start),totalFees,totalSlippage,openPosition:open,pendingLastSignal:sig.at(-1)??null,annual:Object.fromEntries(Object.entries(annual).map(([y,v])=>[y,v.endEquity/v.startEquity-1]))},trades,equity}
}
const ss=signalSets(source)
// Verify simplified B/S extraction against the actual indicator event generator.
for(const len of [3,50,200,source.length]){
 const h=source.slice(0,len),actual=calculateWaveSignals(h).events.map(es=>es.some(e=>e.name==='转向买')?'B':es.some(e=>e.name==='转向卖')?'S':null)
 assert.deepEqual(signals(h.map(p=>p.close)),actual)
}
const results={historical:run(source,ss.final),realtime:run(source,ss.live),observed:run(source,ss.observed),observedNoCost:run(source,ss.observed,{fee:0,slip:0}),buyHold:run(source,[],{buyHold:true}),realtimeNoCost:run(source,ss.live,{fee:0,slip:0}),historicalNoCost:run(source,ss.final,{fee:0,slip:0})}
const sensitivity=[5,8,10,12,15].map(percent=>{const s=signalSets(source,percent);return {percent,observed:run(source,s.observed).summary,historical:run(source,s.final).summary,realtime:run(source,s.live).summary}})
const windows=['2023-01-01','2024-01-01','2025-01-01'].map(date=>{const start=source.findIndex(p=>p.date>=date);return {date,observed:run(source,ss.observed,{start}).summary,historical:run(source,ss.final,{start}).summary,realtime:run(source,ss.live,{start}).summary,buyHold:run(source,[],{start,buyHold:true}).summary}})
const index=load('h30269-extended.json');validateHistory(index);const ix=signalSets(index)
const indexResults={observed:run(index,ix.observed,{fee:0,slip:0,lot:.000001}).summary,historical:run(index,ix.final,{fee:0,slip:0,lot:.000001}).summary,realtime:run(index,ix.live,{fee:0,slip:0,lot:.000001}).summary,buyHold:run(index,[],{fee:0,slip:0,lot:.000001,buyHold:true}).summary}
const repaint={historicalB:ss.final.filter(x=>x==='B').length,historicalS:ss.final.filter(x=>x==='S').length,realtimeB:ss.live.filter(x=>x==='B').length,realtimeS:ss.live.filter(x=>x==='S').length,realtimeDisappeared:[]}
for(let i=0;i<source.length;i++)if(ss.live[i]&&ss.live[i]!==ss.final[i])repaint.realtimeDisappeared.push({date:source[i].date,then:ss.live[i],final:ss.final[i]})
for(const [name,r] of Object.entries(results)){
 assert.ok(r.equity.every(p=>p.cash>=-1e-6&&p.shares>=0))
 assert.ok(r.trades.every(t=>t.buyDate>t.signalDate&&t.sellDate>t.sellSignalDate))
 assert.ok(Math.abs(r.summary.finalEquity-initial-r.trades.reduce((s,t)=>s+t.pnl,0)-(r.summary.openPosition?.pnl??0))<1e-6)
 writeFileSync(new URL(`${name}-details.json`,dir),JSON.stringify(r,null,2))
}
const output={assumptions:{initial,zigPercent:10,feePerSide:.0001,minCommission:5,slippagePerSide:.0005,lot:100,execution:'next session open',priceAdjustment:'unadjusted; OHLC identical to forward-adjusted over sample',start:source[0].date,end:source.at(-1).date,bars:source.length,sha256:createHash('sha256').update(JSON.stringify(source)).digest('hex')},results:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.summary])),repaint,sensitivity,windows,indexResults}
writeFileSync(new URL('summary.json',dir),JSON.stringify(output,null,2))
console.log(JSON.stringify({observed:output.results.observed,observedNoCost:output.results.observedNoCost.totalReturn,indexObserved:indexResults.observed.totalReturn},null,2))
