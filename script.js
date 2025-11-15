const API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";

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
const timeframes = {
  "monthly": {mult: 1, span: "month"},
  "weekly":  {mult: 1, span: "week"},
  "daily":   {mult: 1, span: "day"},
  "4hour":   {mult: 4, span: "hour"},
  "1hour":   {mult: 1, span: "hour"},
};

// ---------------- API FETCH ----------------
async function fetchAggs(ticker, mult, span) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/2004-01-01/${today()}?sort=asc&limit=500&apiKey=${API_KEY}`;
  try {
    let data = await fetch(url).then(r => r.json());
    return data.results || [];
  } catch (e) {
    return [];
  }
}

const today = () => new Date().toISOString().slice(0,10);

// ---------------- RSI FUNCTION ----------------
function rsi(values, period = 14) {
  if (values.length < period + 1) return NaN;

  let gains = [], losses = [];
  for (let i = 1; i < values.length; i++) {
    let diff = values[i] - values[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  let avgGain = average(gains.slice(-period));
  let avgLoss = average(losses.slice(-period));

  if (avgLoss === 0) return 100;

  let rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

const average = arr => arr.reduce((a,b)=>a+b,0) / arr.length;

const sma = (values, n) => values.length >= n ? average(values.slice(-n)) : NaN;

const trend = (s50, s200) =>
  isNaN(s50) || isNaN(s200) ? "Neutral" :
  s50 > s200 ? "Up" :
  s50 < s200 ? "Down" : "Neutral";

// ---------------- RUN ----------------
document.getElementById("runBtn").onclick = async () => {
  const pair = document.getElementById("pairSelect").value;

  document.getElementById("results").innerHTML =
    `<div class="bg-white p-6 rounded-xl shadow mb-4">Running analysis...</div>`;

  let results = {};
  let dailyBars = [];

  for (let tf in timeframes) {
    let {mult, span} = timeframes[tf];
    let bars = await fetchAggs(pair, mult, span);

    if (tf === "daily") dailyBars = bars;

    if (bars.length === 0) {
      results[tf] = {Error: "No data"};
      continue;
    }

    let closes = bars.map(b => b.c);

    let s50 = sma(closes, 50);
    let s200 = sma(closes, 200);
    let rsiValue = rsi(closes);

    results[tf] = {
      Close: closes.at(-1),
      RSI: rsiValue.toFixed(2),
      SMA50: s50,
      SMA200: s200,
      Trend: trend(s50, s200),
      Bars: closes.length
    };
  }

  // Overall Logic
  const tlist = Object.values(results)
    .map(v => v.Trend).filter(t => t !== "Neutral");

  const dominant = tlist.length ?
    tlist.sort((a,b)=>tlist.filter(v=>v===a).length - tlist.filter(v=>v===b).length).pop()
    : "Neutral";

  const rsiList = Object.values(results)
    .map(v => parseFloat(v.RSI))
    .filter(v => !isNaN(v));

  const avgRsi = rsiList.length ? (rsiList.reduce((a,b)=>a+b)/rsiList.length).toFixed(2) : "N/A";

  let advice = "NEUTRAL";
  if (dominant === "Up" && avgRsi < 45) advice = "STRONG BUY";
  else if (dominant === "Down" && avgRsi > 55) advice = "STRONG SELL";
  else if (dominant === "Up") advice = "BUY";
  else if (dominant === "Down") advice = "SELL";

  results["Overall"] = {Dominant: dominant, AvgRSI: avgRsi, Advice: advice};

  renderResults(results);
  renderCharts(dailyBars);
};

// ---------------- RESULTS RENDERING ----------------
function renderResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = "";

  for (let tf in results) {
    let r = results[tf];
    let cls = (tf === "Overall")
      ? "bg-white p-6 rounded-xl shadow timeframe-card overall"
      : "bg-white p-6 rounded-xl shadow timeframe-card";

    container.innerHTML += `
      <div class="${cls} mb-6">
        <h2 class="text-xl font-bold mb-2">${tf.toUpperCase()}</h2>
        <pre>${JSON.stringify(r, null, 2)}</pre>
      </div>
    `;
  }
}

// ---------------- CHARTS ----------------
function renderCharts(bars) {
  if (!bars.length) return;

  // Prepare data
  const candleData = bars.map(b => ({
    time: b.t / 1000,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c
  }));

  const closes = bars.map(b => b.c);
  const rsiData = closes.map((v, i) => ({
    time: bars[i].t / 1000,
    value: rsi(closes.slice(0, i + 1))
  }));

  // Clear old charts
  document.getElementById("chart").innerHTML = "";
  document.getElementById("rsiChart").innerHTML = "";

  // Main Chart
  const chart = LightweightCharts.createChart(document.getElementById("chart"), {
    layout: { background: { color: "#ffffff" }, textColor: "#333" },
    grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } }
  });

  const candleSeries = chart.addCandlestickSeries();
  candleSeries.setData(candleData);

  // RSI Chart
  const rsiChart = LightweightCharts.createChart(document.getElementById("rsiChart"), {
    layout: { background: { color: "#ffffff" }, textColor: "#333" }
  });

  const rsiSeries = rsiChart.addLineSeries();
  rsiSeries.setData(rsiData);
}
