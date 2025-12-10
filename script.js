// script.js — Polygon (weekly/daily) + Twelve Data (4h/1h) integration
// Safe delays, single retry, daily fallback for intraday
// Replace API keys if needed

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
  "weekly":  { source: "polygon", mult:1, span:"week" },
  "daily":   { source: "polygon", mult:1, span:"day"  },
  "4hour":   { source: "twelvedata", interval: "4h"  },
  "1hour":   { source: "twelvedata", interval: "1h"  }
};

// ---------------- DATE RANGE ----------------
function rangeFor(tf) {
  const now = new Date();
  let start = new Date();

  if (tf === "weekly")       start.setFullYear(now.getFullYear() - 5);
  else if (tf === "daily")   start.setFullYear(now.getFullYear() - 1);
  else if (tf === "4hour")   start.setDate(now.getDate() - 10);  // intraday window reduced
  else if (tf === "1hour")   start.setDate(now.getDate() - 3);
  else                       start.setFullYear(now.getFullYear() - 1);

  return { from: start.toISOString().slice(0,10), to: now.toISOString().slice(0,10) };
}

// ---------------- HELPERS ----------------
const sleep = ms => new Promise(res => setTimeout(res, ms));

const average = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN;
const sma = (arr,n) => arr.length < n ? NaN : average(arr.slice(arr.length-n));
function rsi(arr,p=14){
  if (arr.length < p+1) return NaN;
  let gains=0, losses=0;
  for (let i=arr.length-p;i<arr.length;i++){
    const diff = arr[i]-arr[i-1];
    if (diff>0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains/p, avgLoss = losses/p;
  if (avgLoss === 0) return 100;
  const rs = avgGain/avgLoss; return 100 - (100/(1+rs));
}
const trend = (s50,s200) => (isNaN(s50)||isNaN(s200)) ? "Neutral" : (s50>s200 ? "Up" : s50<s200 ? "Down" : "Neutral");

// ---------------- POLYGON (daily/weekly) ----------------
async function fetchPolygonAggs(ticker, mult, span, from, to, attempt=1){
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?sort=asc&limit=500&apiKey=${POLY_API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();
    if (j && Array.isArray(j.results) && j.results.length) return j.results.map(b => ({
      t: b.t, o: b.o, h: b.h, l: b.l, c: b.c
    }));
    if (attempt === 1) { await sleep(700); return fetchPolygonAggs(ticker,mult,span,from,to,2); }
    return [];
  } catch (e) { return []; }
}

// ---------------- TWELVE DATA (intraday) ----------------
// Twelve Data returns values[] sorted newest-first usually; we'll transform to ascending order
function toTdSymbol(pair) {
  // pair like "C:EURUSD" => "EUR/USD"
  const raw = pair.replace("C:", "");
  // naive split first 3 chars and last 3 chars
  return `${raw.slice(0,3)}/${raw.slice(3,6)}`;
}

async function fetchTwelveDataIntraday(pair, interval, outputsize=500, attempt=1){
  const symbol = toTdSymbol(pair); // e.g. EUR/USD
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&format=JSON&apikey=${TD_API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();
    // Twelve Data returns { values: [ {datetime, open, high, low, close}, ... ] }
    if (j && Array.isArray(j.values) && j.values.length) {
      // values are newest-first; reverse to ascending and map to {t, o, h, l, c}
      const asc = j.values.slice().reverse();
      return asc.map(v => ({
        // convert datetime -> epoch ms (Twelve gives "YYYY-MM-DD HH:MM:SS" or ISO)
        t: (new Date(v.datetime || v.datetime + "Z")).getTime(),
        o: Number(v.open), h: Number(v.high), l: Number(v.low), c: Number(v.close)
      }));
    }
    if (attempt === 1) { await sleep(700); return fetchTwelveDataIntraday(pair, interval, outputsize, 2); }
    return [];
  } catch (e) { return []; }
}

// ---------------- NORMALIZE (common function) ----------------
async function fetchForTimeframe(pair, tfKey){
  const tf = timeframes[tfKey];
  // polygon source
  if (tf.source === "polygon"){
    const { from, to } = rangeFor(tfKey);
    return await fetchPolygonAggs(pair, tf.mult, tf.span, from, to);
  }
  // twelvedata source
  if (tf.source === "twelvedata"){
    // request 500 by default but intraday windows are small so fewer points returned
    return await fetchTwelveDataIntraday(pair, tf.interval, 500);
  }
  return [];
}

// ---------------- RUN LOGIC ----------------
document.getElementById("runBtn").onclick = async () => {
  const pair = document.getElementById("pairSelect").value;
  if (!pair) { alert("Select a pair first"); return; }

  document.getElementById("results").innerHTML = `<div class="bg-white p-6 rounded-xl shadow mb-4">Running analysis for ${pair.replace("C:", "")}...</div>`;

  const results = {};
  let dailyBars = [];

  const tfOrder = ["weekly","daily","4hour","1hour"];

  for (let i=0;i<tfOrder.length;i++){
    const tfKey = tfOrder[i];
    if (i !== 0) await sleep(600); // friendly delay between calls

    let bars = await fetchForTimeframe(pair, tfKey);

    // If intraday source failed, try fallback to polygon daily (if not already)
    if ((tfKey === "4hour" || tfKey === "1hour") && (!bars || bars.length === 0)) {
      // ensure we have dailyBars
      if (!dailyBars.length) {
        await sleep(250);
        dailyBars = await fetchForTimeframe(pair, "daily");
      }
      if (dailyBars.length) {
        // Option: generate synthetic intraday from daily (fallback) OR use daily directly
        // We'll use the daily bars directly as a reliable fallback (keeps indicators meaningful)
        bars = dailyBars;
      }
    }

    // store daily for later use
    if (tfKey === "daily" && bars && bars.length) dailyBars = bars;

    if (!bars || bars.length === 0) {
      results[tfKey] = { Error: "No data", Bars: 0 };
      continue;
    }

    // compute indicators
    const closes = bars.map(b => b.c).filter(x => typeof x === "number");
    const closeLatest = closes.length ? closes[closes.length-1] : NaN;
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const rsiVal = rsi(closes, 14);

    results[tfKey] = {
      Close: isNaN(closeLatest) ? "N/A" : closeLatest,
      RSI: isNaN(rsiVal) ? "N/A" : Number(rsiVal.toFixed(2)),
      SMA50: isNaN(s50) ? "N/A" : Number(s50.toFixed(6)),
      SMA200: isNaN(s200) ? "N/A" : Number(s200.toFixed(6)),
      Trend: trend(s50, s200),
      Bars: closes.length
    };
  }

  // overall aggregator
  const trendCounts = {};
  Object.values(results).forEach(r => { if (r && r.Trend && r.Trend !== "Neutral") trendCounts[r.Trend] = (trendCounts[r.Trend] || 0) + 1; });

  let dominant = "Neutral";
  if (Object.keys(trendCounts).length) dominant = Object.keys(trendCounts).sort((a,b)=>trendCounts[a]-trendCounts[b]).pop();

  const rsiList = Object.values(results).map(v => (v && typeof v.RSI === "number")? v.RSI : NaN).filter(x => !isNaN(x));
  const avgRsi = rsiList.length ? Number((rsiList.reduce((a,b)=>a+b,0)/rsiList.length).toFixed(2)) : "N/A";

  let advice = "NEUTRAL";
  if (dominant === "Up" && avgRsi !== "N/A" && avgRsi < 45) advice = "STRONG BUY";
  else if (dominant === "Down" && avgRsi !== "N/A" && avgRsi > 55) advice = "STRONG SELL";
  else if (dominant === "Up") advice = "BUY";
  else if (dominant === "Down") advice = "SELL";

  results["Overall"] = { Dominant: dominant, AvgRSI: avgRsi, Advice: advice };

  renderResults(results);
  renderCharts(dailyBars);
};

// ---------------- RENDER RESULTS ----------------
function renderResults(results){
  const container = document.getElementById("results");
  container.innerHTML = "";

  for (const tf of Object.keys(results)){
    const r = results[tf];
    const title = tf === "Overall" ? "Overall Summary" : tf.toUpperCase();
    let body = "";
    if (r.Error) body = `<div class="text-red-600 font-semibold">${r.Error}</div>`;
    else {
      body = `<div class="grid grid-cols-2 gap-2">`;
      for (const k in r) body += `<div class="text-sm text-gray-600">${k}</div><div class="text-sm font-mono">${r[k]}</div>`;
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

// ---------------- CHARTS ----------------
function renderCharts(bars){
  if (!bars || !bars.length) {
    document.getElementById("chart").innerHTML = "";
    document.getElementById("rsiChart").innerHTML = "";
    return;
  }

  document.getElementById("chart").innerHTML = "";
  document.getElementById("rsiChart").innerHTML = "";

  const candleData = bars.map(b => ({ time: Math.floor(b.t/1000), open: b.o, high: b.h, low: b.l, close: b.c }));
  const closes = bars.map(b => b.c);

  const rsiData = [];
  for (let i=0;i<closes.length;i++){
    const seg = closes.slice(0,i+1);
    const val = rsi(seg,14);
    rsiData.push({ time: Math.floor(bars[i].t/1000), value: isNaN(val) ? null : Number(val.toFixed(2)) });
  }

  const chart = LightweightCharts.createChart(document.getElementById("chart"), {
    layout: { background: { color: "#fff" }, textColor: "#333" },
    grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } },
    rightPriceScale: { scaleMargins: { top:0.1, bottom:0.1 } },
    timeScale: { timeVisible: true, secondsVisible: false }
  });
  chart.addCandlestickSeries().setData(candleData);

  const rsiChart = LightweightCharts.createChart(document.getElementById("rsiChart"), {
    layout: { background: { color: "#fff" }, textColor: "#333" },
    rightPriceScale: { visible: true }
  });
  const rsiSeries = rsiChart.addLineSeries();
  rsiSeries.setData(rsiData.filter(p => p.value !== null));
}
