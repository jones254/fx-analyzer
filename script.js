// script.js — Free-Tier Optimized Version (No Monthly, Smart Intraday, Safe Rate-Limit)

const API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";

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

// ---------------- TIMEFRAMES (monthly removed) ----------------
const timeframes = {
  "weekly":  { mult: 1, span: "week" },
  "daily":   { mult: 1, span: "day" },
  "4hour":   { mult: 4, span: "hour" },
  "1hour":   { mult: 1, span: "hour" }
};

// ---------------- DATE RANGE ----------------
function rangeFor(tf) {
  const now = new Date();
  let start = new Date();

  if (tf === "weekly")       start.setFullYear(now.getFullYear() - 5);
  else if (tf === "daily")   start.setFullYear(now.getFullYear() - 1);
  else if (tf === "4hour")   start.setDate(now.getDate() - 10);  // reduced for free tier
  else if (tf === "1hour")   start.setDate(now.getDate() - 3);   // reduced for free tier
  else                       start.setFullYear(now.getFullYear() - 1);

  return {
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10)
  };
}

// ---------------- SMALL RATE LIMITER ----------------
const sleep = ms => new Promise(res => setTimeout(res, ms));

// ---------------- API FETCH WITH RETRY ----------------
async function fetchAggs(ticker, tf, attempt = 1) {
  const { mult, span } = timeframes[tf] || { mult: 1, span: "day" };
  const { from, to } = rangeFor(tf);

  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?sort=asc&limit=500&apiKey=${API_KEY}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];

    const data = await resp.json();
    if (data && Array.isArray(data.results) && data.results.length > 0) {
      return data.results;
    }

    // RETRY ONCE
    if (attempt === 1) {
      await sleep(700);
      return await fetchAggs(ticker, tf, 2);
    }

    return [];
  } catch {
    return [];
  }
}

// ---------------- INDICATOR HELPERS ----------------
const average = arr => arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : NaN;

const sma = (arr, n) =>
  arr.length < n ? NaN : average(arr.slice(arr.length - n));

function rsi(arr, p = 14) {
  if (arr.length < p + 1) return NaN;
  let gains = 0, losses = 0;

  for (let i = arr.length - p; i < arr.length; i++) {
    const diff = arr[i] - arr[i-1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / p;
  const avgLoss = losses / p;

  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

const trend = (s50, s200) =>
  (isNaN(s50) || isNaN(s200)) ? "Neutral" :
  s50 > s200 ? "Up" : s50 < s200 ? "Down" : "Neutral";

// ---------------- RUN LOGIC ----------------
document.getElementById("runBtn").onclick = async () => {
  const pair = document.getElementById("pairSelect").value;
  if (!pair) return alert("Select a pair first");

  document.getElementById("results").innerHTML =
    `<div class="bg-white p-6 rounded-xl shadow mb-4">Running analysis for ${pair}...</div>`;

  let results = {};
  let dailyBars = [];

  const tfKeys = ["weekly", "daily", "4hour", "1hour"];  // fixed order

  for (let i = 0; i < tfKeys.length; i++) {
    const tf = tfKeys[i];

    if (i !== 0) await sleep(600); // free-tier friendly

    let bars = await fetchAggs(pair, tf);

    // fallback for intraday
    if ((tf === "4hour" || tf === "1hour") && bars.length === 0) {
      if (!dailyBars.length === 0)
        dailyBars = await fetchAggs(pair, "daily");

      if (dailyBars.length)
        bars = dailyBars;
    }

    if (tf === "daily" && bars.length)
      dailyBars = bars;

    if (!bars.length) {
      results[tf] = { Error: "No data", Bars: 0 };
      continue;
    }

    const closes = bars.map(b => b.c);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const rsiVal = rsi(closes, 14);

    results[tf] = {
      Close: closes.at(-1),
      RSI: isNaN(rsiVal) ? "N/A" : Number(rsiVal.toFixed(2)),
      SMA50: isNaN(s50) ? "N/A" : Number(s50.toFixed(6)),
      SMA200: isNaN(s200) ? "N/A" : Number(s200.toFixed(6)),
      Trend: trend(s50, s200),
      Bars: closes.length
    };
  }

  // ---------------- OVERALL SUMMARY ----------------
  const trends = Object.values(results).map(r => r.Trend).filter(t => t !== "Neutral");
  const up = trends.filter(t => t === "Up").length;
  const down = trends.filter(t => t === "Down").length;

  let dominant = "Neutral";
  if (up > down) dominant = "Up";
  if (down > up) dominant = "Down";

  const rsiAvg = average(
    Object.values(results)
      .map(r => typeof r.RSI === "number" ? r.RSI : NaN)
      .filter(x => !isNaN(x))
  );

  let advice = "NEUTRAL";
  if (dominant === "Up" && rsiAvg < 45) advice = "STRONG BUY";
  else if (dominant === "Down" && rsiAvg > 55) advice = "STRONG SELL";
  else if (dominant === "Up") advice = "BUY";
  else if (dominant === "Down") advice = "SELL";

  results["Overall"] = {
    Dominant: dominant,
    AvgRSI: isNaN(rsiAvg) ? "N/A" : Number(rsiAvg.toFixed(2)),
    Advice: advice
  };

  renderResults(results);
  renderCharts(dailyBars);  
};

// ---------------- RENDER RESULTS ----------------
function renderResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = "";

  for (let tf of Object.keys(results)) {
    const r = results[tf];
    const title = tf === "Overall" ? "Overall Summary" : tf.toUpperCase();

    let html = "";
    if (r.Error) {
      html = `<div class="text-red-600 font-semibold">${r.Error}</div>`;
    } else {
      html = `<div class="grid grid-cols-2 gap-2">`;
      for (const k in r) {
        html += `<div class="text-sm text-gray-600">${k}</div><div class="text-sm font-mono">${r[k]}</div>`;
      }
      html += "</div>";
    }

    container.innerHTML += `
      <div class="bg-white p-6 rounded-xl shadow mb-6">
        <h2 class="text-xl font-bold mb-2">${title}</h2>
        ${html}
      </div>
    `;
  }
}

// ---------------- CHARTS ----------------
function renderCharts(bars) {
  if (!bars.length) return;

  document.getElementById("chart").innerHTML = "";
  document.getElementById("rsiChart").innerHTML = "";

  const candleData = bars.map(b => ({
    time: Math.floor(b.t / 1000),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c
  }));

  const closes = bars.map(b => b.c);
  const rsiData = closes.map((_, i) => {
    const val = rsi(closes.slice(0, i + 1), 14);
    return {
      time: Math.floor(bars[i].t / 1000),
      value: isNaN(val) ? null : Number(val.toFixed(2))
    };
  });

  const chart = LightweightCharts.createChart(document.getElementById("chart"), {
    layout: { background: { color: "#fff" }, textColor: "#333" },
    grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } }
  });
  chart.addCandlestickSeries().setData(candleData);

  const rsiChart = LightweightCharts.createChart(document.getElementById("rsiChart"), {
    layout: { background: { color: "#fff" }, textColor: "#333" }
  });
  rsiChart.addLineSeries().setData(rsiData.filter(x => x.value !== null));
}
