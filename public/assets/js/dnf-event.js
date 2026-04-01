import { formatNumber, loadSummaryBundle, toNumber } from "./data.js";
import { initDnfShell } from "./dnf-shell.js";

function numericValues(rows, keyPath) {
  const path = keyPath.split(".");
  return rows
    .map((row) => {
      let value = row;
      for (const key of path) {
        value = value?.[key];
      }
      return toNumber(value);
    })
    .filter((value) => Number.isFinite(value));
}

function average(values) {
  if (!values.length) {
    return Number.NaN;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return Number.NaN;
  }
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 0) {
    return (ordered[middle - 1] + ordered[middle]) / 2;
  }
  return ordered[middle];
}

function minValue(values) {
  if (!values.length) {
    return Number.NaN;
  }
  return Math.min(...values);
}

function clearNode(node) {
  if (node) {
    node.textContent = "";
  }
}

function renderKpis(bundle) {
  const container = document.getElementById("kpiGrid");
  if (!container) {
    return;
  }

  const athletes = bundle.overview?.athletes || [];
  const fastest25 = minValue(numericValues(bundle["25m"]?.athletes || [], "time_s"));
  const fastest50 = minValue(numericValues(bundle["50m"]?.athletes || [], "time_s"));
  const medianDistance = median(numericValues(bundle.total?.athletes || [], "distance_m"));

  const rows = [
    { label: "Athletes", value: String(athletes.length) },
    { label: "Fastest 25m", value: `${formatNumber(fastest25, 2)} s` },
    { label: "Fastest 50m", value: `${formatNumber(fastest50, 2)} s` },
    { label: "Median Total Distance", value: `${formatNumber(medianDistance, 2)} m` },
  ];

  container.textContent = "";
  rows.forEach((row) => {
    const tile = document.createElement("article");
    tile.className = "kpi-tile";
    tile.innerHTML = `<p class="kpi-label">${row.label}</p><p class="kpi-value">${row.value}</p>`;
    container.appendChild(tile);
  });
}

function renderCheckpointTable(bundle) {
  const container = document.getElementById("checkpointTable");
  if (!container) {
    return;
  }

  const checkpoints = ["25m", "50m", "total"];
  const rows = checkpoints.map((checkpoint) => {
    const athletes = bundle[checkpoint]?.athletes || [];
    return {
      checkpoint,
      averageTime: average(numericValues(athletes, "time_s")),
      averageSpeed: average(numericValues(athletes, "avg_speed_mps")),
      averageImpulse: average(numericValues(athletes, "total_impulse")),
    };
  });

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Checkpoint</th>
          <th>Avg Time (s)</th>
          <th>Avg Speed (m/s)</th>
          <th>Avg Impulse</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${row.checkpoint}</td>
            <td>${formatNumber(row.averageTime, 2)}</td>
            <td>${formatNumber(row.averageSpeed, 3)}</td>
            <td>${formatNumber(row.averageImpulse, 2)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  return rows;
}

function renderBarChart(elementId, rows, key, formatter) {
  const container = document.getElementById(elementId);
  if (!container) {
    return;
  }
  clearNode(container);

  const validRows = rows.filter((row) => Number.isFinite(toNumber(row[key])));
  const max = Math.max(...validRows.map((row) => row[key]), 0);

  validRows.forEach((row) => {
    const bar = document.createElement("div");
    bar.className = "bar";

    const height = max > 0 ? Math.max(8, (row[key] / max) * 130) : 8;
    bar.style.height = `${height}px`;
    bar.title = `${row.checkpoint}: ${formatter(row[key])}`;

    const label = document.createElement("span");
    label.textContent = row.checkpoint;

    bar.appendChild(label);
    container.appendChild(bar);
  });
}

function renderGallery(categoryRow) {
  const gallery = document.getElementById("distributionGallery");
  if (!gallery) {
    return;
  }
  gallery.textContent = "";

  const distributionImages = categoryRow?.distribution_images || {};
  const imageEntries = Object.entries(distributionImages)
    .flatMap(([checkpoint, images]) =>
      (images || []).map((path) => ({ checkpoint, path }))
    )
    .sort((a, b) => a.path.localeCompare(b.path));

  if (!imageEntries.length) {
    gallery.innerHTML = '<p class="note">No distribution images available for this selection.</p>';
    return;
  }

  imageEntries.forEach((entry) => {
    const figure = document.createElement("figure");
    figure.className = "figure-card";
    const fileName = entry.path.split("/").pop() || "figure";
    figure.innerHTML = `
      <img src="../../${entry.path}" alt="${entry.checkpoint} ${fileName}" loading="lazy" />
      <figcaption class="figure-caption"><span class="mono">${entry.checkpoint}</span> · ${fileName}</figcaption>
    `;
    gallery.appendChild(figure);
  });
}

async function renderOverview(context) {
  const status = document.getElementById("overviewStatus");
  if (status) {
    status.textContent = "Loading summary artifacts...";
  }

  try {
    const bundle = await loadSummaryBundle(context.manifest, context.event, context.category);
    renderKpis(bundle);
    const rows = renderCheckpointTable(bundle) || [];
    renderBarChart("speedBars", rows, "averageSpeed", (value) => `${formatNumber(value, 3)} m/s`);
    renderBarChart("impulseBars", rows, "averageImpulse", (value) => formatNumber(value, 2));
    renderGallery(context.categoryRow);
    if (status) {
      status.textContent = "Showing cohort benchmark snapshot and checkpoint trends.";
    }
  } catch (error) {
    if (status) {
      status.textContent = `Failed to load overview data: ${error.message}`;
    }
  }
}

async function main() {
  const shell = await initDnfShell({ activePage: "events" });
  shell.onChange((context) => {
    renderOverview(context);
  });

  const initial = shell.getContext();
  if (initial) {
    await renderOverview(initial);
  }
}

main().catch((error) => {
  const status = document.getElementById("overviewStatus");
  if (status) {
    status.textContent = `Initialization failed: ${error.message}`;
  }
});
