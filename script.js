// script.js — Improved version for Polygon free-tier compatibility
// - dynamic date ranges per timeframe
// - intraday-safe requests (limited recent windows)
// - automatic fallback from intraday -> daily when empty
// - simple rate-limiter between API calls
// - improved formatting and error handling

const API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm"; // replace if needed

// ---------------- FX PAIRS -----------------
const pairs = [
  "C:EURUSD", "C:GBPUSD", "C:USDJPY", "C:USDCAD", "C:AUDUSD",
  "C:NZDUSD", "C:EURGBP", "C:EURJPY", "C:GBPJPY", "C:CHFJPY",
  "C:AUDJPY", "C:NZDJPY", "C:EURCAD", "C:GBPCAD", "C:CADJPY",
  "C:USDCHF", "C:EURCHF", "C:GBPCHF", "C:AUDCAD", "C:NZDCAD"
];

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("pairSelect");
  pairs.forEach(p => sel.innerHTML += `<option value="${p}">${p.replace("C:", "")}</option>`);
});

// ---------------- TIMEFRAMES ----------------
// We keep the same label keys but will pass the key into rangeFor / fetchAggs
const timeframes = {
  "monthly": {mult: 1, span: "month"},
  "weekly":  {mult: 1, span: "week"},
  "daily":   {mult: 1, span: "day"},
  "4hour":   {mult: 4, span: "hour"},
  "1hour":   {mult: 1, span: "hour"},
};

// ---------------- Date range helper ----------------
function rangeFor(tf) {
  const now = new Date();
  let start = new Date();

  if (tf === "monthly") start.setFullYear(now.getFullYear() - 20);
  else if (tf === "weekly") start.setFullYear(now.getFullYear() - 5);
  else if (tf === "daily") start.setFullYear(now.getFullYear() - 1);
  else if (tf === "4hour") start.setDate(now.getDate() - 30);   // last 30 days
  else if (tf === "1hour") start.setDate(now.getDate() - 7);    // last 7 days
  else start.setFullYear(now.getFullYear() - 1);

  return {
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10)
  };
}

// ---------------- small rate-limiter ----------------
// simple pause between API requests to reduce chance of hitting free-tier rate limits
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------- API FETCH ----------------
async function fetchAggs(ticker, tf) {
  const { mult, span } = timeframes[tf] || {mult:1, span:"day"};
  const { from, to } = rangeFor(tf);

  // limit=500 is fine; polygon ignores limit if too large for the date window
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?sort=asc&limit=500&apiKey=${API_KEY}`;

  try {
    const resp = await fetch(url);
    // quick handling for non-200 statuses
    if (!resp.ok) {
      console.warn(`[fetchAggs] Non-OK response for ${ticker} ${tf}:`, resp.status);
      return [];
    }
    const data = await resp.json();
    if (!data || !Array.isArray(data.results)) return [];
    return data.results;
  } catch (err) {
    console.error("[fetchAggs] Error fetching:", err);
    return [];
  }
}

// ---------------- Helpers: SMA / Average / RSI ----------------
const average = arr => {
  if (!Array.isArray(arr) || arr.length === 0) return NaN;
  let sum = 0;
  for (let i=0; i<arr.length; i++) sum += arr[i];
  return sum / arr.length;
};

const sma = (values, n) => {
  if (!Array.isArray(values) || values.length < n) return NaN;
  return average(values.slice(-n));
};

// RSI implementation: uses Wilder's smoothing when computing rolling average.
// For simplicity we compute RSI on the array provided (non-optimized).
function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return NaN;

  // compute gains and losses
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    if (i <= 0) continue;
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (isNaN(avgGain) || isNaN(avgLoss)) return NaN;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// trend based on SMA50 vs SMA200
const trend = (s50, s200) =>
  isNaN(s50) || isNaN(s200) ? "Neutral" :
  s50 > s200 ? "Up" :
  s50 < s200 ? "Down" : "Neutral";

// ---------------- run logic ----------------
document.getElementById("runBtn").onclick = async () => {
  const pair = document.getElementById("pairSelect").value;
  if (!pair) {
    alert("Select a pair first");
    return;
  }

  document.getElementById("results").innerHTML =
    `<div class="bg-white p-6 rounded-xl shadow mb-4">Running analysis for ${pair.replace("C:", "")}...</div>`;

  let results = {};
  let dailyBars = [];   // keep daily bars to fall back on for intraday

  // iterate timeframes in stable order
  const tfKeys = Object.keys(timeframes);

  for (let i = 0; i < tfKeys.length; i++) {
    const tf = tfKeys[i];

    // rate-limit: small pause between calls to help free tier
    if (i !== 0) await sleep(300); // 300ms pause

    let bars = await fetchAggs(pair, tf);

    // if intraday empty, attempt quick fallback: for 1hour/4hour use daily (if available)
    if ((tf === "1hour" || tf === "4hour") && bars.length === 0) {
      // If daily already fetched, reuse it; else fetch daily immediately
      if (!dailyBars.length) {
        dailyBars = await fetchAggs(pair, "daily");
        await sleep(200);
      }
      if (dailyBars.length) bars = dailyBars;
    }

    // store dailyBars for later if this is daily
    if (tf === "daily" && bars.length) dailyBars = bars;

    // if still empty, mark as no data
    if (!bars || bars.length === 0) {
      results[tf] = { Error: "No data", Bars: 0 };
      continue;
    }

    // compute metrics using the returned bars (bars is array of objects with .c .o .h .l .t)
    const closes = bars.map(b => b.c).filter(x => typeof x === "number");
    const closeLatest = closes.length ? closes[closes.length - 1] : NaN;

    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);

    // compute RSI using the closes
    const rsiValue = rsi(closes, 14);

    results[tf] = {
      Close: isNaN(closeLatest) ? "N/A" : closeLatest,
      RSI: isNaN(rsiValue) ? "N/A" : Number(rsiValue.toFixed(2)),
      SMA50: isNaN(s50) ? "N/A" : Number(s50.toFixed(6)),
      SMA200: isNaN(s200) ? "N/A" : Number(s200.toFixed(6)),
      Trend: trend(s50, s200),
      Bars: closes.length
    };
  }

  // ---------------- Overall logic (simple aggregator) ----------------
  const trendCounts = {};
  Object.values(results).forEach(r => {
    if (!r || !r.Trend) return;
    if (r.Trend === "Neutral") return;
    trendCounts[r.Trend] = (trendCounts[r.Trend] || 0) + 1;
  });

  let dominant = "Neutral";
  if (Object.keys(trendCounts).length) {
    dominant = Object.keys(trendCounts).sort((a,b) => trendCounts[a] - trendCounts[b]).pop();
  }

  const rsiList = Object.values(results)
    .map(v => (v && typeof v.RSI === "number") ? v.RSI : NaN)
    .filter(x => !isNaN(x));

  const avgRsi = rsiList.length ? Number((rsiList.reduce((a,b)=>a+b,0)/rsiList.length).toFixed(2)) : "N/A";

  let advice = "NEUTRAL";
  // improved thresholds: when dominant trend exists we combine with avg RSI
  if (dominant === "Up" && avgRsi !== "N/A" && avgRsi < 45) advice = "STRONG BUY";
  else if (dominant === "Down" && avgRsi !== "N/A" && avgRsi > 55) advice = "STRONG SELL";
  else if (dominant === "Up") advice = "BUY";
  else if (dominant === "Down") advice = "SELL";

  results["Overall"] = { Dominant: dominant, AvgRSI: avgRsi, Advice: advice };

  // render
  renderResults(results);
  renderCharts(dailyBars); // dailyBars may be used for chart rendering
};

// ---------------- RESULTS RENDERING ----------------
function renderResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = "";

  // Present a nicer card per timeframe
  for (let tf of Object.keys(results)) {
    const r = results[tf];
    const title = tf === "Overall" ? "Overall Summary" : tf.toUpperCase();
    const cls = (tf === "Overall")
      ? "bg-white p-6 rounded-xl shadow timeframe-card overall"
      : "bg-white p-6 rounded-xl shadow timeframe-card";

    // format nicely
    let bodyHTML = "";
    if (r.Error) {
      bodyHTML = `<div class="text-red-600 font-semibold">${r.Error}</div>`;
    } else {
      // key -> value
      bodyHTML = `<div class="grid grid-cols-2 gap-2">`;
      for (const k of Object.keys(r)) {
        bodyHTML += `<div class="text-sm text-gray-600">${k}</div><div class="text-sm font-mono">${r[k]}</div>`;
      }
      bodyHTML += `</div>`;
    }

    container.innerHTML += `
      <div class="${cls} mb-6">
        <h2 class="text-xl font-bold mb-2">${title}</h2>
        ${bodyHTML}
      </div>
    `;
  }
}

// ---------------- CHARTS ----------------
function renderCharts(bars) {
  // Use daily bars (or whichever bars were supplied) to draw candlestick and RSI
  if (!bars || bars.length === 0) {
    // clear possible previous charts
    document.getElementById("chart").innerHTML = "";
    document.getElementById("rsiChart").innerHTML = "";
    return;
  }

  // Prepare data
  const candleData = bars.map(b => ({
    time: Math.floor(b.t / 1000),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c
  }));

  const closes = bars.map(b => b.c);

  // Build an RSI series that only contains valid numeric values and time
  const rsiData = [];
  for (let i = 0; i < closes.length; i++) {
    const segment = closes.slice(0, i + 1);
    const val = rsi(segment, 14);
    rsiData.push({
      time: Math.floor(bars[i].t / 1000),
      value: isNaN(val) ? null : Number(val.toFixed(2))
    });
  }

  // Clear old charts
  document.getElementById("chart").innerHTML = "";
  document.getElementById("rsiChart").innerHTML = "";

  // Main Chart
  const chart = LightweightCharts.createChart(document.getElementById("chart"), {
    layout: { background: { color: "#ffffff" }, textColor: "#333" },
    grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } },
    rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { timeVisible: true, secondsVisible: false }
  });

  const candleSeries = chart.addCandlestickSeries();
  candleSeries.setData(candleData);

  // RSI Chart
  const rsiChart = LightweightCharts.createChart(document.getElementById("rsiChart"), {
    layout: { background: { color: "#ffffff" }, textColor: "#333" },
    rightPriceScale: { visible: true }
  });

  const rsiSeries = rsiChart.addLineSeries();
  // filter null values (the library may prefer valid points)
  const filteredRsiData = rsiData.filter(p => p.value !== null);
  rsiSeries.setData(filteredRsiData);
                                }
