// REGISTER FINANCIAL ELEMENTS
Chart.register(
  CandlestickController,
  FinancialElement,
  CategoryScale,
  LinearScale,
  TimeScale
);

const API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";

const PAIRS = [
  "EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD",
  "NZDUSD","EURGBP","EURJPY","EURCHF","EURAUD","EURNZD",
  "GBPJPY","GBPCHF","GBPAUD","AUDJPY","CADJPY","CHFJPY",
  "AUDNZD","NZDCAD"
];

const sel = document.getElementById("pairSelect");
PAIRS.forEach(p => sel.innerHTML += `<option value="C:${p}">${p}</option>`);

function today(){ return new Date().toISOString().slice(0,10); }

async function fetchAggs(t,m,s){
  let url=`https://api.polygon.io/v2/aggs/ticker/${t}/range/${m}/${s}/2004-01-01/${today()}?limit=500&sort=desc&apiKey=${API_KEY}`;
  let r=await fetch(url); let d=await r.json(); return d.results?d.results.reverse():[];
}

function sma(a,n){ return a.length<n?NaN:a.slice(-n).reduce((x,y)=>x+y)/n; }

function rsi(v,p=14){
  if(v.length<p+1) return NaN;
  let g=[],l=[];
  for(let i=1;i<v.length;i++){
    let d=v[i]-v[i-1];
    g.push(Math.max(d,0)); l.push(Math.max(-d,0));
  }
  let ag=g.slice(-p).reduce((a,b)=>a+b)/p;
  let al=l.slice(-p).reduce((a,b)=>a+b)/p;
  if(al===0) return 100;
  return 100-(100/(1+ag/al));
}

function trend(s50,s200){
  if(isNaN(s50)||isNaN(s200)) return "Neutral";
  return s50>s200?"Up":s50<s200?"Down":"Neutral";
}

let candleChart,rsiChart;

function renderCharts(bars){
  const ctx1=document.getElementById("candlesChart").getContext("2d");
  const ctx2=document.getElementById("rsiChart").getContext("2d");

  const items=bars.map(b=>({x:new Date(b.t),o:b.o,h:b.h,l:b.l,c:b.c}));

  const closes=bars.map(b=>b.c);
  const rsiArr=closes.map((v,i)=>rsi(closes.slice(0,i+1)));

  if(candleChart) candleChart.destroy();
  if(rsiChart) rsiChart.destroy();

  candleChart=new Chart(ctx1,{
    type:"candlestick",
    data:{datasets:[{label:"Price",data:items,borderColor:"#3b82f6"}]},
    options:{
      parsing:false,
      scales:{
        x:{type:"time",grid:{color:"rgba(255,255,255,0.06)"}},
        y:{grid:{color:"rgba(255,255,255,0.08)"}}
      }
    }
  });

  rsiChart=new Chart(ctx2,{
    type:"line",
    data:{
      labels:bars.map(b=>new Date(b.t)),
      datasets:[{
        label:"RSI",
        data:rsiArr,
        borderColor:"#06b6d4",
        borderWidth:2,
        pointRadius:0,
        tension:0.15
      }]
    },
    options:{
      scales:{
        y:{min:0,max:100,grid:{color:"rgba(255,255,255,0.08)"}},
        x:{type:"time",grid:{color:"rgba(255,255,255,0.06)"}}
      }
    }
  });
}

const timeframes={
  "Monthly":{mult:1,span:"month"},
  "Weekly":{mult:1,span:"week"},
  "Daily":{mult:1,span:"day"},
  "4H":{mult:4,span:"hour"},
  "1H":{mult:1,span:"hour"},
};

document.getElementById("runBtn").onclick=async()=>{
  const pair=sel.value;

  document.getElementById("overallBox").innerHTML =
    `<div class="glass signal-box p-4 mt-4 animate-pulse">
      Running Analysis...
    </div>`;

  let results={}; let forCharts=[];

  for(let tf in timeframes){
    let {mult,span}=timeframes[tf];
    let bars=await fetchAggs(pair,mult,span);

    if(tf==="Daily") forCharts=bars;

    if(!bars.length){ results[tf]={error:"No data"}; continue; }

    let closes=bars.map(b=>b.c);
    let s50=sma(closes,50);
    let s200=sma(closes,200);

    results[tf]={
      Close:closes.at(-1),
      RSI:rsi(closes).toFixed(2),
      SMA50:isNaN(s50)?"-":s50.toFixed(5),
      SMA200:isNaN(s200)?"-":s200.toFixed(5),
      Trend:trend(s50,s200)
    };
  }

  let trends=Object.values(results).map(v=>v.Trend).filter(t=>t!=="Neutral");
  let dominant=trends.length?trends.sort((a,b)=>
    trends.filter(x=>x===a).length - trends.filter(x=>x===b).length
  ).pop():"Neutral";

  let rsiVals=Object.values(results).map(v=>parseFloat(v.RSI)).filter(v=>!isNaN(v));
  let avgRsi=(rsiVals.reduce((a,b)=>a+b,0)/rsiVals.length).toFixed(2);

  let advice="NEUTRAL";
  if(dominant==="Up"&&avgRsi<45) advice="STRONG BUY";
  else if(dominant==="Down"&&avgRsi>55) advice="STRONG SELL";
  else if(dominant==="Up") advice="BUY";
  else if(dominant==="Down") advice="SELL";

  document.getElementById("overallBox").innerHTML =
    `<div class="glass signal-box p-4 mt-4">
      <h2 class="text-xl font-bold">${pair.replace("C:","")} Signal</h2>
      <p class="mt-2"><b>Trend:</b> ${dominant}</p>
      <p><b>Avg RSI:</b> ${avgRsi}</p>
      <p class="text-2xl font-bold mt-4 text-blue-400">${advice}</p>
    </div>`;

  let box="";
  for(let tf in results){
    let r=results[tf];
    box+=`
      <div class="glass p-4">
        <h3 class="text-lg font-bold mb-2">${tf}</h3>
        <p>Close: ${r.Close}</p>
        <p>RSI: ${r.RSI}</p>
        <p>SMA50: ${r.SMA50}</p>
        <p>SMA200: ${r.SMA200}</p>
        <p>Trend: <b>${r.Trend}</b></p>
      </div>`;
  }

  document.getElementById("tfResults").innerHTML=box;

  if(forCharts.length) renderCharts(forCharts);
};
