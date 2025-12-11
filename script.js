// -----------------------------------------------------------
// FX Analyzer Script
// Polygon (weekly/daily) + TwelveData (4h/1h)
// Includes defensive renderCharts() to avoid blank charts
// -----------------------------------------------------------

const POLY_API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";
const TD_API_KEY   = "d1babeb679ab40b3874b0541d46f6059";

// ---------------- FX PAIRS -----------------
const pairs = [
  "C:EURUSD","C:GBPUSD","C:USDJPY","C:USDCAD","C:AUDUSD",
  "C:NZDUSD","C:EURGBP","C:EURJPY","C:GBPJPY","C:CHFJPY",
  "C:AUDJPY","C:NZDJPY","C:EURCAD","C:GBPCAD","C:CADJPY",
  "C:USDCHF","C:EURCHF","C:GBPCHF","C:AUDCAD","C:NZDCAD"
];

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("pairSelect");
  pairs.forEach(p => sel.innerHTML += `<option value="${p}">${p.replace("C:", "")}</option>`);
});

// ---------------- TIMEFRAMES ----------------
const timeframes = {
  "weekly":  { source: "polygon", mult: 1, span: "week" },
  "daily":   { source: "polygon", mult: 1, span: "day"  },
  "4hour":   { source: "twelvedata", interval: "4h" },
  "1hour":   { source: "twelvedata", interval: "1h" }
};

// ---------------- DATE RANGE ----------------
function rangeFor(tf) {
  const now = new Date();
  let start = new Date();

  if (tf === "weekly") start.setFullYear(now.getFullYear() - 5);
  else if (tf === "daily") start.setFullYear(now.getFullYear() - 1);
  else if (tf === "4hour") start.setDate(now.getDate() - 10);
  else if (tf === "1hour") start.setDate(now.getDate() - 3);

  return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

const average = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN;
const sma = (arr,n) => arr.length < n ? NaN : average(arr.slice(arr.length-n));

function rsi(arr, p=14) {
  if (arr.length < p+1) return NaN;
  let gains=0, losses=0;
  for (let i=arr.length-p; i<arr.length; i++){
    const diff = arr[i]-arr[i-1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains/p, avgLoss = losses/p;
  if (avgLoss === 0) return 100;
  return 100 - 100/(1 + avgGain/avgLoss);
}

const trend = (s50,s200) =>
  (isNaN(s50)||isNaN(s200)) ? "Neutral"
  : (s50 > s200 ? "Up" : s50 < s200 ? "Down" : "Neutral");

// ---------------- POLYGON FETCH ----------------
async function fetchPolygonAggs(ticker, mult, span, from, to, attempt=1){
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?sort=asc&limit=500&apiKey=${POLY_API_KEY}`;
  try{
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();
    if (j && Array.isArray(j.results) && j.results.length)
      return j.results.map(b => ({ t:b.t, o:b.o, h:b.h, l:b.l, c:b.c }));
    if (attempt === 1){ await sleep(700); return fetchPolygonAggs(ticker,mult,span,from,to,2); }
    return [];
  }catch(e){ return []; }
}

// ---------------- TWELVEDATA FETCH ----------------
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
        t: new Date(v.datetime).getTime(),
        o: Number(v.open),
        h: Number(v.high),
        l: Number(v.low),
        c: Number(v.close)
      }));
    }

    if (attempt === 1){ await sleep(700); return fetchTwelveDataIntraday(pair,interval,outputsize,2); }
    return [];
  }catch(e){ return []; }
}

// ---------------- NORMAL FETCH WRAPPER ----------------
async function fetchForTimeframe(pair, tfKey){
  const tf = timeframes[tfKey];
  if (tf.source === "polygon"){
    const { from, to } = rangeFor(tfKey);
    return await fetchPolygonAggs(pair, tf.mult, tf.span, from, to);
  }
  if (tf.source === "twelvedata"){
    return await fetchTwelveDataIntraday(pair, tf.interval, 500);
  }
  return [];
}

// ---------------- RUN ANALYSIS ----------------
document.getElementById("runBtn").onclick = async () => {
  const pair = document.getElementById("pairSelect").value;
  if (!pair) return alert("Select a pair first");

  document.getElementById("results").innerHTML =
    `<div class="bg-white p-6 rounded-xl shadow mb-4">Running analysis...</div>`;

  const results = {};
  let dailyBars = [];

  const tfOrder = ["weekly","daily","4hour","1hour"];

  for (let i=0;i<tfOrder.length;i++){
    const tfKey = tfOrder[i];

    if (i !== 0) await sleep(600);

    let bars = await fetchForTimeframe(pair, tfKey);

    // Intraday fallback → daily
    if ((tfKey==="4hour" || tfKey==="1hour") && (!bars || bars.length === 0)) {
      if (!dailyBars.length){
        dailyBars = await fetchForTimeframe(pair, "daily");
      }
      bars = dailyBars;
    }

    // Save daily
    if (tfKey==="daily" && bars.length)
      dailyBars = bars;

    if (!bars.length){
      results[tfKey] = { Error:"No data", Bars:0 };
      continue;
    }

    const closes = bars.map(b=>b.c);
    const latest = closes.at(-1);
    const s50 = sma(closes,50);
    const s200 = sma(closes,200);
    const rsiVal = rsi(closes,14);

    results[tfKey] = {
      Close: latest,
      RSI: isNaN(rsiVal)?"N/A":Number(rsiVal.toFixed(2)),
      SMA50: isNaN(s50)?"N/A":Number(s50.toFixed(6)),
      SMA200: isNaN(s200)?"N/A":Number(s200.toFixed(6)),
      Trend: trend(s50,s200),
      Bars: closes.length
    };
  }

  // ----------- OVERALL SUMMARY -----------
  const trendCounts = {};
  for (const t of Object.values(results)){
    if (t.Trend && t.Trend !== "Neutral")
      trendCounts[t.Trend] = (trendCounts[t.Trend]||0)+1;
  }

  let dominant = "Neutral";
  if (Object.keys(trendCounts).length){
    dominant = Object.keys(trendCounts).reduce((a,b)=>trendCounts[a]>trendCounts[b]?a:b);
  }

  const rsiVals = Object.values(results)
    .filter(v=>typeof v.RSI==="number")
    .map(v=>v.RSI);

  const avgRsi = rsiVals.length ? Number((rsiVals.reduce((a,b)=>a+b,0)/rsiVals.length).toFixed(2)) : "N/A";

  let advice = "NEUTRAL";
  if (dominant==="Up" && avgRsi<45) advice="STRONG BUY";
  else if (dominant==="Down" && avgRsi>55) advice="STRONG SELL";
  else if (dominant==="Up") advice="BUY";
  else if (dominant==="Down") advice="SELL";

 // ---- CONFIDENCE SCORE CALCULATION ----
function calculateConfidence(results, dailyBars) {
    let score = 0;

    // 1. TREND AGREEMENT (0–40)
    const trends = Object.keys(results)
        .filter(tf => tf !== "Overall")
        .map(tf => results[tf].Trend);

    const dominant = results["Overall"].Dominant;
    const agreeing = trends.filter(t => t === dominant).length;

    const trendScore = (agreeing / trends.length) * 40;
    score += trendScore;

    // 2. RSI SUPPORT (0–20)
    const rsis = Object.keys(results)
        .filter(tf => tf !== "Overall")
        .map(tf => results[tf].RSI)
        .filter(v => typeof v === "number");

    let rsiSupports = 0;

    if (dominant === "Up") {
        rsiSupports = rsis.filter(v => v < 55).length;
    } else if (dominant === "Down") {
        rsiSupports = rsis.filter(v => v > 45).length;
    }

    const rsiScore = (rsiSupports / rsis.length) * 20;
    score += rsiScore;

    // 3. SMA ALIGNMENT (0–20)
    let smaSupports = 0;
    const totalSMAs = trends.length;

    Object.keys(results).forEach(tf => {
        if (tf === "Overall") return;

        const { SMA50, SMA200 } = results[tf];
        if (typeof SMA50 !== "number" || typeof SMA200 !== "number") return;

        if (dominant === "Up"  && SMA50 > SMA200) smaSupports++;
        if (dominant === "Down" && SMA50 < SMA200) smaSupports++;
    });

    const smaScore = (smaSupports / totalSMAs) * 20;
    score += smaScore;

    // 4. DATA QUALITY (0–10)
    let totalBars = 0;
    let expectedBars = 0;

    Object.keys(results).forEach(tf => {
        if (tf === "weekly") expectedBars += 250;
        if (tf === "daily") expectedBars += 365;
        if (tf === "4hour") expectedBars += 200;
        if (tf === "1hour") expectedBars += 120;

        if (results[tf].Bars) totalBars += results[tf].Bars;
    });

    const dataQualityScore = Math.min((totalBars / expectedBars) * 10, 10);
    score += dataQualityScore;

    // 5. VOLATILITY STABILITY (0–10)
    if (dailyBars && dailyBars.length > 0) {
        const closes = dailyBars.map(b => b.c);

        const avg = closes.reduce((a, b) => a + b) / closes.length;
        const variance = closes.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / closes.length;
        const std = Math.sqrt(variance);

        // Inverse volatility mapping
        // Lower std → higher score
        let volScore = 10 - Math.min(std * 2, 10);
        if (volScore < 0) volScore = 0;

        score += volScore;
    }

    return Math.round(score);
}

// Add confidence to overall result
const confidenceScore = calculateConfidence(results, dailyBars);

results["Overall"] = {
    Dominant: dominant,
    AvgRSI: avgRsi,
    Advice: advice,
    Confidence: confidenceScore + "%"
};

renderResults(results);
renderCharts(dailyBars);


};

// ---------------- RENDER RESULTS ----------------
function renderResults(results){
  const container = document.getElementById("results");
  container.innerHTML = "";

  for (const tf in results){
    const r = results[tf];
    const title = tf==="Overall" ? "Overall Summary" : tf.toUpperCase();

    let rows="";
    if (r.Error){
      rows = `<div class="text-red-600 font-semibold">${r.Error}</div>`;
    } else {
      rows = `<div class="grid grid-cols-2 gap-2">`;
      for (const k in r){
        rows += `<div class="text-sm text-gray-600">${k}</div>
                 <div class="text-sm font-mono">${r[k]}</div>`;
      }
      rows += `</div>`;
    }

    container.innerHTML += `
      <div class="bg-white p-6 rounded-xl shadow mb-6">
        <h2 class="text-xl font-bold mb-2">${title}</h2>
        ${rows}
      </div>
    `;
  }
}

// ---------------- CHARTS (DEFENSIVE VERSION) ----------------
function renderCharts(bars){
  try{
    console.log("[renderCharts] Bars:", bars.length);

    const chartEl = document.getElementById("chart");
    const rsiEl   = document.getElementById("rsiChart");

    chartEl.innerHTML = "";
    rsiEl.innerHTML   = "";

    if (!bars.length){
      console.warn("No bars for chart.");
      return;
    }

    // Convert → LightweightCharts format
    let candleData = bars.map(b => ({
      time: Math.floor(Number(b.t)/1000),
      open: Number(b.o),
      high: Number(b.h),
      low:  Number(b.l),
      close:Number(b.c)
    }));

    // Validate times, fix if needed
    let broken=false;
    for (let i=1;i<candleData.length;i++){
      if (candleData[i].time <= candleData[i-1].time){
        broken=true; break;
      }
    }
    if (broken){
      console.warn("Bad timestamps detected → fixing");
      const base = Math.floor(Date.now()/1000) - candleData.length*3600;
      candleData = candleData.map((c,idx)=>({...c,time:base+idx*3600}));
    }

    // Create chart
    const chart = LightweightCharts.createChart(chartEl, {
      layout:{background:{color:"#fff"},textColor:"#333"},
      grid:{vertLines:{color:"#eee"},horzLines:{color:"#eee"}},
      rightPriceScale:{scaleMargins:{top:0.1,bottom:0.1}},
      timeScale:{timeVisible:true,secondsVisible:false}
    });

    const cs = chart.addCandlestickSeries();
    cs.setData(candleData);

    // RSI
    const closes = candleData.map(c=>c.close);
    const rsiSeriesData = closes.map((v,i)=>{
      const sub = closes.slice(0,i+1);
      const rv = rsi(sub,14);
      return {time:candleData[i].time, value:isNaN(rv)?null:Number(rv.toFixed(2))};
    }).filter(p=>p.value!==null);

    const rsiChart = LightweightCharts.createChart(rsiEl, {
      layout:{background:{color:"#fff"},textColor:"#333"},
      rightPriceScale:{visible:true}
    });

    const rsiSeries = rsiChart.addLineSeries();
    rsiSeries.setData(rsiSeriesData);

  }catch(err){
    console.error("RenderCharts error:", err);
  }
}
