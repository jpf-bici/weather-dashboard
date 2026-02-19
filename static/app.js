function fmtLocalTime(isoZ) {
  if (!isoZ) return "—";
  const d = new Date(isoZ);
  return d.toLocaleString();
}

function fmtNum(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return Number(x).toFixed(digits);
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json();
}

let tempChart, humChart, presChart;

function buildLineChart(ctx, dataPoints, yLabel) {
  return new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: yLabel,
          data: dataPoints,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "time",
          time: {
            unit: "day",
            displayFormats: { day: "MMM d" },
          },
          ticks: { maxTicksLimit: 10 },
        },
        y: { ticks: { maxTicksLimit: 6 } },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

async function refresh() {
  const [summary, ts] = await Promise.all([
    getJSON("/api/summary"),
    getJSON("/api/timeseries?days=7"),
  ]);

  // KPI: current
  document.getElementById("curTemp").textContent =
    `${fmtNum(summary.current.temp_f, 2)} °F`;
  document.getElementById("curHum").textContent =
    `${fmtNum(summary.current.humidity_pct, 2)} %`;
  document.getElementById("curPres").textContent =
    `${fmtNum(summary.current.pressure_hpa, 2)} hPa`;

  const curTs = fmtLocalTime(summary.current.ts_utc);
  document.getElementById("curTempTs").textContent = curTs;
  document.getElementById("curHumTs").textContent = curTs;
  document.getElementById("curPresTs").textContent = curTs;

  // KPI: 24h high/low
  document.getElementById("tHigh").textContent =
    summary.temp_24h_high.temp_f === null
      ? "—"
      : `${fmtNum(summary.temp_24h_high.temp_f, 2)} °F`;
  document.getElementById("tHighTs").textContent = fmtLocalTime(
    summary.temp_24h_high.ts_utc,
  );

  document.getElementById("tLow").textContent =
    summary.temp_24h_low.temp_f === null
      ? "—"
      : `${fmtNum(summary.temp_24h_low.temp_f, 2)} °F`;
  document.getElementById("tLowTs").textContent = fmtLocalTime(
    summary.temp_24h_low.ts_utc,
  );

  // KPI: pressure delta (24h)
  const delta = summary.pressure_change_hpa;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  document.getElementById("presDelta").textContent =
    `${direction} ${fmtNum(Math.abs(delta), 2)} hPa`;
  document.getElementById("presDeltaSub").textContent =
    `vs ${fmtLocalTime(summary.pressure_24h_reference.ts_utc)} reference`;

  document.getElementById("lastUpdated").textContent =
    `Last updated: ${fmtLocalTime(summary.current.ts_utc)}`;

  // Charts — use `{x: timestamp, y: value}` points so Chart.js time scale
  const tempPoints = ts.map((p) => ({ x: p.ts_utc, y: p.temp_f }));
  const humPoints = ts.map((p) => ({ x: p.ts_utc, y: p.humidity_pct }));
  const presPoints = ts.map((p) => ({ x: p.ts_utc, y: p.pressure_hpa }));

  if (!tempChart) {
    tempChart = buildLineChart(
      document.getElementById("chartTemp"),
      tempPoints,
      "Temp (°F)",
    );
    humChart = buildLineChart(
      document.getElementById("chartHum"),
      humPoints,
      "Humidity (%)",
    );
    presChart = buildLineChart(
      document.getElementById("chartPres"),
      presPoints,
      "Pressure (hPa)",
    );
  } else {
    for (const [chart, dataPoints] of [
      [tempChart, tempPoints],
      [humChart, humPoints],
      [presChart, presPoints],
    ]) {
      chart.data.datasets[0].data = dataPoints;
      chart.update();
    }
  }
}

(async () => {
  try {
    await refresh();
    // Refresh every 60s; your data changes every 10 min, so this is safe.
    setInterval(() => refresh().catch(console.error), 60_000);
  } catch (e) {
    console.error(e);
    document.getElementById("lastUpdated").textContent =
      `Error loading data: ${e.message}`;
  }
})();
