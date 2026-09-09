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
    const p=h[i],observation=i>start?sig[i-1]:null
    const signal=buyHold?(i===start?'B':null):observation?.sells.length?'S':observation?.buys.length?'B':null
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

const accepted=new Set(['共振买点','转向买','波段卖','转向卖'])
function replay(h,{reappear=false}={}){
 const seen=new Set(),firstSeen=new Map(),observations=[],ledger=[],disappearances=[],snapshots={}
 let previous=new Map()
 for(let t=0;t<h.length;t++){
  const calculated=calculateWaveSignals(h.slice(0,t+1),{zigPercent:10,sellPeriod:3}),fresh=[],current=new Map()
  calculated.events.forEach((events,j)=>events.filter(e=>accepted.has(e.name)).forEach(e=>{
   const key=`${h[j].date}:${e.name}`
   const event={key,name:e.name,side:e.side,markerDate:h[j].date,markerIndex:j,observedDate:h[t].date,observedIndex:t,delayBars:t-j}
   current.set(key,event)
   if(!(reappear?previous:seen).has(key)){
    fresh.push({...event,firstObservedDate:firstSeen.get(key)??h[t].date,reappeared:seen.has(key)})
    if(!seen.has(key))firstSeen.set(key,h[t].date)
   }
   seen.add(key)
  }))
  for(const [key,event] of previous)if(!current.has(key))disappearances.push({key,name:event.name,markerDate:event.markerDate,disappearedDate:h[t].date})
  ledger.push(...fresh)
  observations.push({date:h[t].date,buys:fresh.filter(e=>e.side==='buy'),sells:fresh.filter(e=>e.side==='sell')})
  if(['2026-01-05','2026-05-29','2026-07-01','2026-08-04',h.at(-1).date].includes(h[t].date))snapshots[h[t].date]=[...current.values()].map(e=>({...e,firstObservedDate:firstSeen.get(e.key)}))
  previous=current
  if(t%250===0)console.log(`Replayed ${t+1}/${h.length}`)
 }
 return {observations,ledger,disappearances,snapshots}
}
const replayed=replay(source)
const result=run(source,replayed.observations),free=run(source,replayed.observations,{fee:0,slip:0}),benchmark=run(source,[],{buyHold:true})
const byDate=new Map(replayed.observations.map(o=>[o.date,o]))
for(const r of [result,free]){
 for(const t of r.trades){t.buySignals=byDate.get(t.signalDate).buys;t.sellSignals=byDate.get(t.sellSignalDate).sells
  assert.ok(t.buySignals.length&&t.sellSignals.length);assert.equal(byDate.get(t.signalDate).sells.length,0)
  assert.ok(t.buySignals.every(e=>e.markerDate<=e.observedDate&&e.observedDate<t.buyDate))
  assert.ok(t.sellSignals.every(e=>e.markerDate<=e.observedDate&&e.observedDate<t.sellDate))
 }
 if(r.summary.openPosition)r.summary.openPosition.buySignals=byDate.get(r.summary.openPosition.signalDate).buys
 assert.ok(r.equity.every(e=>e.cash>=-1e-6&&e.shares>=0))
 assert.ok(Math.abs(r.summary.finalEquity-initial-r.trades.reduce((s,t)=>s+t.pnl,0)-(r.summary.openPosition?.pnl??0))<1e-6)
}
// Synthetic observations verify disappearance cannot close/reopen positions and conflict prioritizes selling.
const fake=Array.from({length:8},(_,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,open:1,close:1,high:1,low:1}))
const bs=(b=false,s=false)=>({buys:b?[{name:'B'}]:[],sells:s?[{name:'S'}]:[]})
const check=run(fake,[bs(true),bs(),bs(true),bs(true,true),bs(),bs(true,true),bs(true),bs()])
assert.equal(check.trades.length,1);assert.equal(check.trades[0].buyDate,'2026-01-02');assert.equal(check.trades[0].sellDate,'2026-01-05');assert.equal(check.summary.openPosition.buyDate,'2026-01-08')
const windows=[['2026-01-01','2026-01-31'],['2026-05-25','2026-06-05'],['2026-06-25','2026-07-03'],['2026-07-27','2026-08-07']]
const audit=windows.map(([start,end])=>({start,end,firstAppearances:replayed.ledger.filter(e=>e.observedDate>=start&&e.observedDate<=end),markersInRange:replayed.ledger.filter(e=>e.markerDate>=start&&e.markerDate<=end)}))
const conflicts=replayed.observations.filter(o=>o.buys.length&&o.sells.length)
const summary={assumptions:{...JSON.parse(readFileSync(new URL('summary.json',dir),'utf8')).assumptions,rule:'new unique marker-date/name; buy red resonance line or B; sell wave-sell or S; sell wins any same-day conflict; removal ignored',formulaSHA256:createHash('sha256').update(readFileSync(new URL('../../src/utils/waveSignals.js',dir))).digest('hex')},strategy:result.summary,noCost:free.summary,buyHold:benchmark.summary,signalsByType:Object.fromEntries([...accepted].map(name=>[name,replayed.ledger.filter(e=>e.name===name).length])),conflicts,audit}
writeFileSync(new URL('combined-summary.json',dir),JSON.stringify(summary,null,2))
writeFileSync(new URL('combined-details.json',dir),JSON.stringify(result,null,2))
writeFileSync(new URL('combined-signals.json',dir),JSON.stringify(replayed,null,2))
console.log(JSON.stringify(summary,null,2))
