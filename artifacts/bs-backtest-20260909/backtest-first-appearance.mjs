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

// A signal is actionable when its (bar date, B/S) identity is first observed.
// Disappearance never produces an order; executed trades remain in the ledger.
function appearanceSignals(h,{reappear=false,percent=10}={}) {
  const closes=h.map(p=>p.close),seen=new Set(),ledger=[],daily=[],conflicts=[]
  let previous=new Set()
  for(let t=0;t<h.length;t++){
    const current=signals(closes.slice(0,t+1),percent),present=new Set(),fresh=[]
    for(let j=0;j<current.length;j++)if(current[j]){
      const key=`${h[j].date}:${current[j]}`;present.add(key)
      if(!(reappear?previous:seen).has(key)){
        const event={observedDate:h[t].date,observedIndex:t,markerDate:h[j].date,markerIndex:j,type:current[j],reappeared:seen.has(key),delayBars:t-j}
        fresh.push(event);ledger.push(event)
      }
      seen.add(key)
    }
    // If multiple marks first appear at this close, the rightmost fresh mark wins.
    if(new Set(fresh.map(e=>e.type)).size>1)conflicts.push({date:h[t].date,events:fresh})
    daily.push(fresh.at(-1)?.type??null)
    previous=present
  }
  return {daily,ledger,conflicts}
}
function details(appear,h=source,options={}){
 const result=run(h,appear.daily,options)
 for(const trade of result.trades){
   trade.buySignal=appear.ledger.filter(e=>e.observedDate===trade.signalDate).at(-1)
   trade.sellSignal=appear.ledger.filter(e=>e.observedDate===trade.sellSignalDate).at(-1)
   assert.equal(trade.buySignal.type,'B');assert.equal(trade.sellSignal.type,'S')
 }
 const end=result.summary.openPosition
 if(end)end.buySignal=appear.ledger.filter(e=>e.observedDate===end.signalDate).at(-1)
 return result
}
const first=appearanceSignals(source),again=appearanceSignals(source,{reappear:true})
const main=details(first),repeat=details(again),free=details(first,source,{fee:0,slip:0}),hold=run(source,[],{buyHold:true})
const old=JSON.parse(readFileSync(new URL('summary.json',dir),'utf8'))
const sensitivity=[5,8,10,12,15].map(percent=>({percent,...details(appearanceSignals(source,{percent})).summary}))
for(const result of [main,repeat,free,hold]){
 assert.ok(result.equity.every(p=>p.cash>=-1e-6&&p.shares>=0))
 assert.ok(result.trades.every(t=>t.buyDate>t.signalDate&&t.sellDate>t.sellSignalDate))
 assert.ok(Math.abs(result.summary.finalEquity-initial-result.trades.reduce((s,t)=>s+t.pnl,0)-(result.summary.openPosition?.pnl??0))<1e-6)
}
// Check event extraction against the full indicator, including the disputed period.
for(const date of ['2022-03-16','2026-06-23','2026-07-01','2026-07-24','2026-09-09']){
 const h=source.filter(p=>p.date<=date)
 const actual=calculateWaveSignals(h).events.map(es=>es.some(e=>e.name==='转向买')?'B':es.some(e=>e.name==='转向卖')?'S':null)
 assert.deepEqual(signals(h.map(p=>p.close)),actual)
}
const output={assumptions:{...old.assumptions,rule:'first observed unique (marker date, B/S); disappearance ignored; next session open execution; rightmost new mark if same close yields multiple marks'},main:main.summary,repeatAppearance:repeat.summary,noCost:free.summary,buyHold:hold.summary,sensitivity,firstSignalCount:first.ledger.length,reappearanceSignalCount:again.ledger.length,conflicts:first.conflicts,reappearConflicts:again.conflicts,events2026:first.ledger.filter(e=>e.observedDate>='2026-01-01'),trades2026:main.trades.filter(e=>e.sellDate>='2026-01-01')}
writeFileSync(new URL('first-appearance-summary.json',dir),JSON.stringify(output,null,2))
writeFileSync(new URL('first-appearance-details.json',dir),JSON.stringify(main,null,2))
writeFileSync(new URL('first-appearance-signals.json',dir),JSON.stringify(first,null,2))
writeFileSync(new URL('repeat-appearance-details.json',dir),JSON.stringify(repeat,null,2))
console.log(JSON.stringify(output,null,2))
