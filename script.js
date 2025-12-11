// -----------------------------------------------------------
// FX Analyzer Script (with Confidence Score)
// Polygon (weekly/daily) + TwelveData (4h/1h)
// -----------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

// ---------------- API KEYS ----------------
const POLY_API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";
const TD_API_KEY   = "d1babeb679ab40b3874b0541d46f6059";

// ---------------- PAIRS ----------------
const pairs = [
  "C:EURUSD","C:GBPUSD","C:USDJPY","C:USDCAD","C:AUDUSD",
  "C:NZDUSD","C:EURGBP","C:EURJPY","C:GBPJPY","C:CHFJPY",
  "C:AUDJPY","C:NZDJPY","C:EURCAD","C:GBPCAD","C:CADJPY",
  "C:USDCHF","C:EURCHF","C:GBPCHF","C:AUDCAD","C:NZDCAD"
];

const pairSelect = document.getElementById("pairSelect");
pairs.forEach(p => pairSelect.innerHTML += `<option value="${p}">${p.replace("C:", "")}</option>`);

// ---------------- TIMEFRAMES ----------------
const timeframes = {
  "weekly":  { source: "polygon", mult:1, span:"week" },
  "daily":   { source: "polygon", mult:1, span:"day" },
  "4hour":   { source: "twelvedata", interval:"4h" },
  "1hour":   { source: "twelvedata", interval:"1h" }
};

// ---------------- DATE RANGE ----------------
function rangeFor(tf){
  const now = new Date();
  let start = new Date();

  if (tf === "weekly") start.setFullYear(now.getFullYear() - 5);
  else if (tf === "daily") start.setFullYear(now.getFullYear() - 1);
  else if (tf === "4hour") start.setDate(now.getDate() - 10);
  else if (tf === "1hour") start.setDate(now.getDate() - 3);

  return {
    from: start.toISOString().slice(0,10),
    to:   now.toISOString().slice(0,10)
  };
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

// ---------------- INDICATOR HELPERS ----------------
const average = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN;
const sma = (arr,n) => arr.length < n ? NaN : average(arr.slice(arr.length-n));

function rsi(arr, p=14){
  if (arr.length < p+1) return NaN;
  let gains = 0, losses = 0;
  for (let i=arr.length-p; i<arr.length; i++){
    const diff = arr[i] - arr[i-1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains/p;
  const avgLoss = losses/p;
  if (avgLoss === 0) return 100;
  return 100 - 100/(1 + avgGain/avgLoss);
}

const trend = (s50,s200) =>
  (isNaN(s50)||isNaN(s200)) ? "Neutral" :
  (s50 > s200 ? "Up" : s50 < s200 ? "Down" : "Neutral");

// ---------------- FETCH POLYGON ----------------
async function fetchPolygonAggs(ticker, mult, span, from, to, attempt=1){
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?sort=asc&limit=500&apiKey=${POLY_API_KEY}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();

    if (j && Array.isArray(j.results) && j.results.length)
      return j.results.map(b => ({
        t:b.t, o:b.o, h:b.h, l:b.l, c:b.c
      }));

    if (attempt === 1){
      await sleep(700);
      return fetchPolygonAggs(ticker,mult,span,from,to,2);
    }
    return [];

  } catch (e){
    return [];
  }
}

// ---------------- FETCH TWELVEDATA ----------------
function toTdSymbol(pair){
  const raw = pair.replace("C:", "");
  return `${raw.slice(0,3)}/${raw.slice(3,6)}`;
}

async function fetchTwelveDataIntraday(pair, interval, outputsize=500, attempt=1){
  const symbol = toTdSymbol(pair);

  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${TD_API_KEY}`;

  try{
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();

    if (j && Array.isArray(j.values) && j.values.length){
      const asc = j.values.slice().reverse();
      return asc.map(v => ({
        t:new Date(v.datetime).getTime(),
        o:Number(v.open), h:Number(v.high),
        l:Number(v.low),  c:Number(v.close)
      }));
    }

    if (attempt === 1){
      await sleep(700);
      return fetchTwelveDataIntraday(pair,interval,outputsize,2);
    }

    return [];

  }catch(e){
    return [];
  }
}

// ---------------- FETCH WRAPPER ----------------
async function fetchForTimeframe(pair, tfKey){
  const tf = timeframes[tfKey];

  if (tf.source === "polygon"){
    const {from,to} = rangeFor(tfKey);
    return await fetchPolygonAggs(pair,tf.mult,tf.span,from,to);
  }

  if (tf.source === "twelvedata"){
    return await fetchTwelveDataIntraday(pair,tf.interval,500);
  }

  return [];
}

// ---------------- CONFIDENCE SCORE ----------------
function calculateConfidence(results, dailyBars){
  let score = 0;

  const dominant = results["Overall"].Dominant;

  // 1 — TREND AGREEMENT (40)
  const allTrends = Object.keys(results)
    .filter(tf => tf !== "Overall")
    .map(tf => results[tf].Trend);

  const matches = allTrends.filter(t => t === dominant).length;
  score += (matches / allTrends.length) * 40;

  // 2 — RSI SUPPORT (20)
  const rsis = Object.keys(results)
    .filter(tf => tf !== "Overall")
    .map(tf => results[tf].RSI)
    .filter(v => typeof v === "number");

  let rsiSupport = 0;

  if (dominant === "Up")   rsiSupport = rsis.filter(v => v < 55).length;
  if (dominant === "Down") rsiSupport = rsis.filter(v => v > 45).length;

  score += (rsiSupport / rsis.length) * 20;

  // 3 — SMA SUPPORT (20)
  let smaSupport = 0;

  Object.keys(results).forEach(tf => {
    if (tf === "Overall") return;

    const {SMA50,SMA200} = results[tf];
    if (typeof SMA50 !== "number" || typeof SMA200 !== "number") return;

    if (dominant === "Up"   && SMA50 > SMA200) smaSupport++;
    if (dominant === "Down" && SMA50 < SMA200) smaSupport++;
  });

  score += (smaSupport / allTrends.length) * 20;

  // 4 — DATA QUALITY (10)
  let barsReturned = 0;
  let barsExpected = 0;

  Object.keys(results).forEach(tf => {
    if (tf === "weekly") barsExpected += 250;
    if (tf === "daily")  barsExpected += 365;
    if (tf === "4hour")  barsExpected += 200;
    if (tf === "1hour")  barsExpected += 120;

    if (results[tf].Bars) barsReturned += results[tf].Bars;
  });

  score += Math.min((barsReturned / barsExpected) * 10, 10);

  // 5 — VOLATILITY (10)
  if (dailyBars.length > 0){
    const closes = dailyBars.map(b => b.c);
    const avg = closes.reduce((a,b)=>a+b) / closes.length;
    const variance = closes.reduce((a,b)=>a + Math.pow(b - avg,2),0) / closes.length;
    const std = Math.sqrt(variance);

    let volScore = 10 - Math.min(std * 2, 10);
    if (volScore < 0) volScore = 0;

    score += volScore;
  }

  return Math.round(score);
}

// ---------------- RUN ANALYSIS ----------------
document.getElementById("runBtn").onclick = async () => {

  const pair = pairSelect.value;
  if (!pair) return alert("Select a pair first");

  document.getElementById("results").innerHTML =
    `<div class="bg-white p-6 rounded-xl shadow mb-4">Running analysis...</div>`;

  const results = {};
  let dailyBars = [];

  const order = ["weekly","daily","4hour","1hour"];

  for (let i=0;i<order.length;i++){
    const tf = order[i];

    if (i !== 0) await sleep(600);

    let bars = await fetchForTimeframe(pair,tf);

    if ((tf==="4hour"||tf==="1hour") && (!bars || bars.length === 0)){
      if (!dailyBars.length)
        dailyBars = await fetchForTimeframe(pair,"daily");

      bars = dailyBars;
    }

    if (tf==="daily" && bars.length)
      dailyBars = bars;

    if (!bars || bars.length === 0){
      results[tf] = {Error:"No data", Bars:0};
      continue;
    }

    const closes = bars.map(b=>b.c);
    const s50 = sma(closes,50);
    const s200 = sma(closes,200);
    const rsiVal = rsi(closes,14);

    results[tf] = {
      Close: closes.at(-1),
      RSI: isNaN(rsiVal)?"N/A":Number(rsiVal.toFixed(2)),
      SMA50: isNaN(s50)?"N/A":Number(s50.toFixed(6)),
      SMA200: isNaN(s200)?"N/A":Number(s200.toFixed(6)),
      Trend: trend(s50,s200),
      Bars: bars.length
    };
  }

  // ---------------- OVERALL SUMMARY ----------------
  const trendCounts = {};
  Object.values(results).forEach(r=>{
    if (r && r.Trend && r.Trend!=="Neutral")
      trendCounts[r.Trend] = (trendCounts[r.Trend]||0)+1;
  });

  let dominant = "Neutral";
  if (Object.keys(trendCounts).length)
    dominant = Object.keys(trendCounts).reduce((a,b)=>trendCounts[a]>trendCounts[b]?a:b);

  const allRSIs = Object.values(results)
    .map(v=> (typeof v.RSI==="number")?v.RSI:null)
    .filter(x=>x!==null);

  const avgRsi = allRSIs.length
    ? Number((allRSIs.reduce((a,b)=>a+b,0) / allRSIs.length).toFixed(2))
    : "N/A";

  let advice = "NEUTRAL";
  if (dominant==="Up"   && avgRsi < 45) advice="STRONG BUY";
  else if (dominant==="Down" && avgRsi > 55) advice="STRONG SELL";
  else if (dominant==="Up") advice="BUY";
  else if (dominant==="Down") advice="SELL";

  // Build Overall BEFORE confidence
  results["Overall"] = {
    Dominant: dominant,
    AvgRSI: avgRsi,
    Advice: advice
  };

  // Calculate confidence
  const confidenceScore = calculateConfidence(results,dailyBars);
  results["Overall"].Confidence = confidenceScore + "%";

  // Output
  renderResults(results);
  renderCharts(dailyBars);
};

// ---------------- RENDER RESULTS ----------------
function renderResults(results){
  const container = document.getElementById("results");
  container.innerHTML = "";

  for (const tf of Object.keys(results)){
    const r = results[tf];
    const title = tf==="Overall" ? "Overall Summary" : tf.toUpperCase();

    let body = "";
    if (r.Error){
      body = `<div class="text-red-600 font-semibold">${r.Error}</div>`;
    } else {
      body = `<div class="grid grid-cols-2 gap-2">`;
      for (const k in r){
        body += `<div class="text-sm text-gray-600">${k}</div>
                 <div class="text-sm font-mono">${r[k]}</div>`;
      }
      body += `</div>`;
    }

    container.innerHTML += `
      <div class="bg-white p-6 rounded-xl shadow mb-6">
        <h2 class="text-xl font-bold mb-2">${title}</h2>
        ${body}
      </div>
    `;
  }
}

// ---------------- RENDER CHARTS ----------------
function renderCharts(bars){
  try{
    const chartDiv = document.getElementById("chart");
    const rsiDiv   = document.getElementById("rsiChart");

    chartDiv.innerHTML = "";
    rsiDiv.innerHTML   = "";

    if (!bars || bars.length === 0){
      console.warn("No bars for chart.");
      return;
    }

    const candleData = bars.map(b => ({
      time: Math.floor(b.t / 1000),
      open: b.o,
      high: b.h,
      low:  b.l,
      close:b.c
    }));

    const chart = LightweightCharts.createChart(chartDiv,{
      layout:{background:{color:"#fff"},textColor:"#333"},
      grid:{vertLines:{color:"#eee"},horzLines:{color:"#eee"}},
      rightPriceScale:{scaleMargins:{top:0.1,bottom:0.1}},
      timeScale:{timeVisible:true,secondsVisible:false}
    });

    chart.addCandlestickSeries().setData(candleData);

    // RSI
    const closes = bars.map(b=>b.c);
    const rsiData = closes.map((v,i)=>{
      const seg = closes.slice(0,i+1);
      const rv = rsi(seg,14);
      return {
        time: candleData[i].time,
        value: isNaN(rv)?null:Number(rv.toFixed(2))
      };
    }).filter(x => x.value !== null);

    const rsiChart = LightweightCharts.createChart(rsiDiv,{
      layout:{background:{color:"#fff"},textColor:"#333"},
      rightPriceScale:{visible:true}
    });

    rsiChart.addLineSeries().setData(rsiData);

  }catch(err){
    console.error("Chart error:",err);
  }
}

}); // END DOMContentLoaded
