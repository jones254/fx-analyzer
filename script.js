// REGISTER CHART.JS EXTENSIONS PROPERLY
Chart.register(
  Chart.FinancialController,
  Chart.FinancialElement,
  Chart.CandlestickController,
  Chart.OHLCController
);

Chart.register(
  Chart.CategoryScale,
  Chart.LinearScale,
  Chart.TimeScale
);

const API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";

const PAIRS = [
  "EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD",
  "AUDUSD","NZDUSD","EURGBP","EURJPY","EURCHF",
  "EURAUD","EURNZD","GBPJPY","GBPCHF","GBPAUD",
  "AUDJPY","CADJPY","CHFJPY","AUDNZD","NZDCAD"
];

// Populate dropdown safely
const sel = document.getElementById("pairSelect");
PAIRS.forEach(p => {
  sel.innerHTML += `<option value="C:${p}">${p}</option>`;
});

function today() { return new Date().toISOString().slice(0,10); }

async function fetchAggs(ticker, mult, span) {
  let url = 
    `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/2004-01-01/${today()}?limit=500&sort=desc&apiKey=${API_KEY}`;

  let r = await fetch(url);
  let d = await r.json();
  return d.results ? d.results.reverse() : [];
}

function sma(arr, n) {
  if (arr.length < n) return NaN;
  return arr.slice(-n).reduce((a,b)=>a+b,0) / n;
}

function rsi(values, period = 14) {
  if (values.length < period+1) return NaN;

  let gains = [], losses = [];

  for (let i = 1; i < values.length; i++) {
    let d = values[i] - values[i-1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }

  let ag = gains.slice(-period).reduce((a,b)=>a+b) / period;
  let al = losses.slice(-period).reduce((a,b)=>a+b) / period;

  if (al === 0) return 100;
  return 100 - (100 / (1 + ag / al));
}

function trend(s50, s200) {
  if (isNaN(s50) || isNaN(s200)) return "Neutral";
  return s50 > s200 ? "Up" : s50 < s200 ? "Down" : "Neutral";
}

let candleChart, rsiChart;

function renderCharts(bars) {
  const ctx1 = document.getElementById("candlesChart");
  const ctx2 = document.getElementById("rsiChart");

  const candleData = bars.map(b => ({
    x: new Date(b.t),
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c
  }));

  const closes = bars.map(b => b.c);
  const rsiArr = closes.map((v,i) => rsi(closes.slice(0,i+1)));

  if (candleChart) candleChart.destroy();
  if (rsiChart) rsiChart.destroy();

  candleChart = new Chart(ctx1, {
    type: "candlestick",
    data: {
      datasets: [{
        label: "Price",
        data: candleData,
        borderColor: "#3b82f6"
      }]
    },
    options: {
      parsing: false,
      scales: {
        x: { type: "time" },
        y: {}
      }
    }
  });

  rsiChart = new Chart(ctx2, {
    type: "line",
    data: {
      labels: bars.map(b => new Date(b.t)),
      datasets: [{
        label: "RSI",
        data: rsiArr,
        borderColor: "#06b6d4",
        borderWidth: 2,
        pointRadius: 0
      }]
    },
    options: {
      scales: {
        y: { min: 0, max: 100 },
        x: { type: "time" }
      }
    }
  });
}

const timeframes = {
  Monthly: {mult:1, span:"month"},
  Weekly:  {mult:1, span:"week"},
  Daily:   {mult:1, span:"day"},
  "4H":    {mult:4, span:"hour"},
  "1H":    {mult:1, span:"hour"}
};

document.getElementById("runBtn").onclick = async () => {

  const pair = sel.value;
  const overall = document.getElementById("overallBox");

  overall.innerHTML = `<div class="glass p-4">Running Analysis...</div>`;

  let results = {};
  let chartBars = [];

  for (let tf in timeframes) {
    let {mult, span} = timeframes[tf];
    let bars = await fetchAggs(pair, mult, span);

    if (tf === "Daily") chartBars = bars;

    if (!bars.length) {
      results[tf] = {error:"No data"};
      continue;
    }

    const closes = bars.map(b => b.c);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);

    results[tf] = {
      Close: closes.at(-1),
      RSI: rsi(closes).toFixed(2),
      SMA50: isNaN(s50) ? "-" : s50.toFixed(5),
      SMA200: isNaN(s200) ? "-" : s200.toFixed(5),
      Trend: trend(s50, s200)
    };
  }

  const trends = Object.values(results)
    .map(v => v.Trend)
    .filter(t => t !== "Neutral");

  const dominant = trends.length 
    ? trends.sort((a,b) =>
        trends.filter(v=>v===a).length -
        trends.filter(v=>v===b).length
      ).pop()
    : "Neutral";

  const rsiVals = Object.values(results)
    .map(v => parseFloat(v.RSI))
    .filter(v => !isNaN(v));

  const avgRsi = (rsiVals.reduce((a,b)=>a+b,0)/rsiVals.length).toFixed(2);

  let advice = "NEUTRAL";
  if (dominant === "Up" && avgRsi < 45) advice = "STRONG BUY";
  else if (dominant === "Down" && avgRsi > 55) advice = "STRONG SELL";
  else if (dominant === "Up") advice = "BUY";
  else if (dominant === "Down") advice = "SELL";

  overall.innerHTML =
    `<div class="glass p-4">
      <h2 class="text-xl font-bold">${pair.replace("C:", "")}</h2>
      <p><b>Trend:</b> ${dominant}</p>
      <p><b>Average RSI:</b> ${avgRsi}</p>
      <p class="text-2xl font-bold text-blue-400">${advice}</p>
    </div>`;

  let box = "";
  for (let tf in results) {
    let r = results[tf];

    box += `
      <div class="glass p-4">
        <h3 class="font-bold text-lg">${tf}</h3>
        <p>Close: ${r.Close}</p>
        <p>RSI: ${r.RSI}</p>
        <p>SMA50: ${r.SMA50}</p>
        <p>SMA200: ${r.SMA200}</p>
        <p>Trend: ${r.Trend}</p>
      </div>`;
  }

  document.getElementById("tfResults").innerHTML = box;

  if (chartBars.length) renderCharts(chartBars);
};
