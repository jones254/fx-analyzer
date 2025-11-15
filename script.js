const API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm";

const timeframes = {
  "monthly": {mult: 1, span: "month"},
  "weekly":  {mult: 1, span: "week"},
  "daily":   {mult: 1, span: "day"},
  "4hour":   {mult: 4, span: "hour"},
  "1hour":   {mult: 1, span: "hour"},
};

async function fetchAggs(ticker, mult, span) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/2004-01-01/${today()}?sort=desc&limit=500&apiKey=${API_KEY}`;

  try {
    let res = await fetch(url);
    let data = await res.json();

    if (!data.results) return [];
    return data.results.reverse(); // oldest → newest
  } catch (err) {
    console.log(err);
    return [];
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

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

function average(arr) {
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

function sma(values, n) {
  if (values.length < n) return NaN;
  return average(values.slice(-n));
}

function getTrend(sma50, sma200) {
  if (isNaN(sma50) || isNaN(sma200)) return "Neutral";
  if (sma50 > sma200) return "Up";
  if (sma50 < sma200) return "Down";
  return "Neutral";
}

document.getElementById("runBtn").onclick = async () => {
  const pair = document.getElementById("pairSelect").value;
  const container = document.getElementById("results");
  container.innerHTML = `<div class="card">Running analysis for ${pair}...</div>`;

  let results = {};

  for (let tf in timeframes) {
    let {mult, span} = timeframes[tf];

    let bars = await fetchAggs(pair, mult, span);
    if (bars.length === 0) {
      results[tf] = {Error: "No data"};
      continue;
    }

    let closes = bars.map(b => b.c);

    let rsiValue = rsi(closes);
    let sma50 = sma(closes, 50);
    let sma200 = sma(closes, 200);
    let trend = getTrend(sma50, sma200);

    results[tf] = {
      Close: closes.at(-1),
      RSI: rsiValue.toFixed(2),
      SMA50: sma50,
      SMA200: sma200,
      Trend: trend,
      Bars: closes.length
    };
  }

  // --- Overall Logic (same as Python)
  const trendList = Object.values(results)
    .map(v => v.Trend)
    .filter(t => t && t !== "Neutral");

  const dominant = trendList.length
      ? trendList.sort((a,b) =>
          trendList.filter(v => v === a).length -
          trendList.filter(v => v === b).length
        ).pop()
      : "Neutral";

  const rsiList = Object.values(results)
    .map(v => parseFloat(v.RSI))
    .filter(v => !isNaN(v));

  const avgRsi = rsiList.length ? (rsiList.reduce((a,b)=>a+b,0)/rsiList.length).toFixed(2) : "N/A";

  let advice = "NEUTRAL";
  if (dominant === "Up" && avgRsi < 45) advice = "STRONG BUY";
  else if (dominant === "Down" && avgRsi > 55) advice = "STRONG SELL";
  else if (dominant === "Up") advice = "BUY";
  else if (dominant === "Down") advice = "SELL";

  results["Overall"] = {dominant, avgRsi, advice};

  renderResults(results);
};

function renderResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = "";

  for (let tf in results) {
    let r = results[tf];

    let cls = (tf === "Overall") ? "card timeframe-card overall" : "card timeframe-card";

    container.innerHTML += `
      <div class="${cls}">
        <h2>${tf.toUpperCase()}</h2>
        <pre>${JSON.stringify(r, null, 2)}</pre>
      </div>
    `;
  }
}
