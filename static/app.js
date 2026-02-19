function fmtLocalTime(isoZ, timeOnly = false) {
  if (!isoZ) return "—";
  const d = new Date(isoZ);
  if (timeOnly)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); // e.g. "08:23"
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
    `${fmtNum(summary.current.temp_f, 1)} °F`;
  document.getElementById("curHum").textContent =
    `${fmtNum(summary.current.humidity_pct, 1)} %`;
  const presHpa = summary.current.pressure_hpa;
  const presInHg = presHpa * 0.02953;
  document.getElementById("curPres").textContent =
    `${fmtNum(presHpa, 1)} hPa / ${fmtNum(presInHg, 1)} inHg`;

  const curTs = fmtLocalTime(summary.current.ts_utc);

  // KPI: 24h high/low
  document.getElementById("tHigh").textContent =
    summary.temp_24h_high.temp_f === null
      ? "—"
      : `${fmtNum(summary.temp_24h_high.temp_f, 1)} °F`;
  document.getElementById("tHighTs").textContent = `@ ${fmtLocalTime(
    summary.temp_24h_high.ts_utc,
    true,
  )}`; /* timeOnly */

  document.getElementById("tLow").textContent =
    summary.temp_24h_low.temp_f === null
      ? "—"
      : `${fmtNum(summary.temp_24h_low.temp_f, 1)} °F`;
  document.getElementById("tLowTs").textContent =
    `@ ${fmtLocalTime(summary.temp_24h_low.ts_utc, true)}`;

  // KPI: pressure delta (24h)
  const delta = summary.pressure_change_hpa;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  document.getElementById("presDelta").textContent =
    `${direction} ${fmtNum(Math.abs(delta), 1)} hPa`;

  document.getElementById("lastUpdated").textContent =
    `Last updated: ${fmtLocalTime(summary.current.ts_utc)}`;

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
