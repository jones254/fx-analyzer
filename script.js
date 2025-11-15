// REQUIRED registrations for candlesticks
Chart.register(
  CandlestickController,
  FinancialElement,
  CategoryScale,
  LinearScale,
  TimeScale
);


const API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";

const PAIRS = [
  "EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD",
  "AUDUSD","NZDUSD","EURGBP","EURJPY","EURCHF",
  "EURAUD","EURNZD","GBPJPY","GBPCHF","GBPAUD",
  "AUDJPY","CADJPY","CHFJPY","AUDNZD","NZDCAD"
];

// Fill dropdown
const sel = document.getElementById("pairSelect");
PAIRS.forEach(p => sel.innerHTML += `<option value="C:${p}">${p}</option>`);

const timeframes = {
  "Monthly":  {mult: 1, span: "month"},
  "Weekly":   {mult: 1, span: "week"},
  "Daily":    {mult: 1, span: "day"},
  "4H":       {mult: 4, span: "hour"},
  "1H":       {mult: 1, span: "hour"},
};

function today() { return new Date().toISOString().slice(0,10); }

async function fetchAggs(ticker, mult, span) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/2004-01-01/${today()}?limit=500&sort=desc&apiKey=${API_KEY}`;
  let r = await fetch(url);
  let data = await r.json();
  return data.results ? data.results.reverse() : [];
}

function sma(arr, n) {
  if (arr.length < n) return NaN;
  return arr.slice(-n).reduce((a,b)=>a+b,0) / n;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return NaN;

  let gains = [], losses = [];
  for (let i = 1; i < values.length; i++) {
    let diff = values[i] - values[i-1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  let avgGain = gains.slice(-period).reduce((a,b)=>a+b)/period;
  let avgLoss = losses.slice(-period).reduce((a,b)=>a+b)/period;
  if (avgLoss === 0) return 100;

  let rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function trend(s50, s200) {
  if (isNaN(s50) || isNaN(s200)) return "Neutral";
  return s50 > s200 ? "Up" : s50 < s200 ? "Down" : "Neutral";
}

let candleChart, rsiChart;

function renderCharts(bars) {
  const ctx1 = document.getElementById("candlesChart").getContext("2d");
  const ctx2 = document.getElementById("rsiChart").getContext("2d");

  const candleData = bars.map(b => ({
    x: new Date(b.t),
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c
  }));

  const closes = bars.map(b => b.c);
  const rsiArr = closes.map((v, i) => rsi(closes.slice(0, i+1)));

  if (candleChart) candleChart.destroy();
  if (rsiChart) rsiChart.destroy();

  // Candlestick Chart
  candleChart = new Chart(ctx1, {
    type: "candlestick",
    data: {
      datasets: [{
        label: "Price",
        data: candleData
      }]
    },
    options: {
      parsing: false,
      scales: {
        x: {
          type: "time",
          time: { unit: "day" }
        }
      }
    }
  });

  // RSI Chart
  rsiChart = new Chart(ctx2, {
    type: "line",
    data: {
      labels: bars.map(b => new Date(b.t)),
      datasets: [{
        label: "RSI",
        data: rsiArr,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2
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


document.getElementById("runBtn").onclick = async () => {
  const pair = document.getElementById("pairSelect").value;

  document.getElementById("overallBox").innerHTML = `
    <div class="bg-white p-6 shadow-md rounded-xl text-center text-xl font-bold">
      Running analysis for ${pair}...
    </div>
  `;

  let results = {};
  let forCharts = [];

  for (let tf in timeframes) {
    let {mult, span} = timeframes[tf];
    let bars = await fetchAggs(pair, mult, span);

    if (tf === "Daily") forCharts = bars; // used for charts

    if (!bars.length) {
      results[tf] = {error: "No data"};
      continue;
    }

    let closes = bars.map(b => b.c);
    let s50 = sma(closes, 50);
    let s200 = sma(closes, 200);

    results[tf] = {
      Close: closes.at(-1),
      RSI: rsi(closes).toFixed(2),
      SMA50: isNaN(s50) ? "-" : s50.toFixed(5),
      SMA200: isNaN(s200) ? "-" : s200.toFixed(5),
      Trend: trend(s50, s200)
    };
  }

  // ------- Compute Overall -------
  let trendList = Object.values(results)
    .map(v => v.Trend)
    .filter(t => t !== "Neutral");

  let dominant = trendList.length 
      ? trendList.sort((a,b) =>
          trendList.filter(v => v === a).length -
          trendList.filter(v => v === b).length
        ).pop()
      : "Neutral";

  let rsiList = Object.values(results)
    .map(v => parseFloat(v.RSI))
    .filter(v => !isNaN(v));

  const avgRsi = (rsiList.reduce((a,b)=>a+b,0) / rsiList.length).toFixed(2);

  let advice = "NEUTRAL";
  if (dominant === "Up" && avgRsi < 45) advice = "STRONG BUY";
  else if (dominant === "Down" && avgRsi > 55) advice = "STRONG SELL";
  else if (dominant === "Up") advice = "BUY";
  else if (dominant === "Down") advice = "SELL";

  // ------- Render Overall -------
  document.getElementById("overallBox").innerHTML = `
    <div class="bg-white shadow-md p-6 rounded-xl">
      <h2 class="text-3xl font-bold mb-2">Overall Signal</h2>
      <p class="text-lg"><b>Dominant Trend:</b> ${dominant}</p>
      <p class="text-lg"><b>Average RSI:</b> ${avgRsi}</p>
      <p class="text-2xl font-bold mt-4 text-blue-700">${advice}</p>
    </div>
  `;

  // ------- Render Timeframe Results -------
  let box = "";
  for (let tf in results) {
    let r = results[tf];

    box += `
      <div class="bg-white p-5 shadow-md rounded-xl mb-4">
        <h3 class="text-xl font-bold mb-2">${tf}</h3>
        <p>Close: ${r.Close}</p>
        <p>RSI: ${r.RSI}</p>
        <p>SMA50: ${r.SMA50}</p>
        <p>SMA200: ${r.SMA200}</p>
        <p>Trend: <b>${r.Trend}</b></p>
      </div>
    `;
  }
  document.getElementById("tfResults").innerHTML = box;

  // ------- Render Charts -------
  if (forCharts.length) {
    renderCharts(forCharts);
  }
};
