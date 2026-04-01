import { formatNumber, getCategoryRows, getEventIds, loadManifest, loadSummaryBundle, toNumber } from "./data.js";

function supportsDnf(categoryRow) {
  const disciplines = categoryRow?.disciplines || [];
  if (!disciplines.length) {
    return true;
  }
  return disciplines.includes("DNF");
}

function median(values) {
  if (!values.length) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function minValue(values) {
  if (!values.length) {
    return Number.NaN;
  }
  return Math.min(...values);
}

function maxValue(values) {
  if (!values.length) {
    return Number.NaN;
  }
  return Math.max(...values);
}

function formatDuration(seconds) {
  const value = toNumber(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  const minutes = Math.floor(value / 60);
  const sec = value - minutes * 60;
  if (minutes <= 0) {
    return `${sec.toFixed(2)} s`;
  }
  return `${minutes}:${sec.toFixed(2).padStart(5, "0")}`;
}

function formatPercent(ratio, digits = 1) {
  const value = toNumber(ratio);
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function compareByDistanceThenTime(a, b) {
  const distanceA = toNumber(a?.distance);
  const distanceB = toNumber(b?.distance);
  if (Number.isFinite(distanceA) && Number.isFinite(distanceB) && distanceA !== distanceB) {
    return distanceB - distanceA;
  }

  const timeA = toNumber(a?.time);
  const timeB = toNumber(b?.time);
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
    return timeA - timeB;
  }
  return 0;
}

function pickLongestRow(rows) {
  return rows.filter((row) => Number.isFinite(row.distance)).sort(compareByDistanceThenTime)[0];
}

function getDnfSlices(manifest) {
  const slices = [];
  getEventIds(manifest).forEach((eventId) => {
    getCategoryRows(manifest, eventId)
      .filter((categoryRow) => supportsDnf(categoryRow))
      .forEach((categoryRow) => {
        slices.push({ event: eventId, category: categoryRow.id });
      });
  });
  return slices;
}

async function loadSlices(manifest) {
  const slices = getDnfSlices(manifest);
  const loaded = await Promise.all(
    slices.map(async (slice) => {
      const bundle = await loadSummaryBundle(manifest, slice.event, slice.category);
      return { ...slice, bundle };
    })
  );
  return loaded;
}

function indexByAthlete(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    if (row && typeof row.athlete === "string" && row.athlete) {
      map.set(row.athlete, row);
    }
  });
  return map;
}

function flattenAthleteRows(slices) {
  const all = [];
  slices.forEach((slice) => {
    const overviewByAthlete = indexByAthlete(slice.bundle.overview?.athletes || []);
    const twentyFiveByAthlete = indexByAthlete(slice.bundle["25m"]?.athletes || []);
    const fiftyByAthlete = indexByAthlete(slice.bundle["50m"]?.athletes || []);

    (slice.bundle.total?.athletes || []).forEach((totalRow) => {
      const athlete = totalRow?.athlete;
      if (!athlete) {
        return;
      }

      const overview = overviewByAthlete.get(athlete);
      const row25 = twentyFiveByAthlete.get(athlete);
      const row50 = fiftyByAthlete.get(athlete);

      const distance = toNumber(totalRow.distance_m);
      const time = toNumber(totalRow.time_s);
      const speed = toNumber(totalRow.avg_speed_mps);

      const cycleTime = toNumber(overview?.cycle_time_s);
      const cycleDistance = toNumber(overview?.cycle_distance_m);
      const cycleGlideTime = toNumber(totalRow?.cycle?.glide_time_s);
      const wallPushGlideDistance = toNumber(totalRow?.glide_avg_by_label?.WALL_PUSH?.distance_m);

      const glideShare =
        Number.isFinite(cycleTime) && cycleTime > 0 && Number.isFinite(cycleGlideTime)
          ? cycleGlideTime / cycleTime
          : Number.NaN;
      const cyclesEstimate =
        Number.isFinite(distance) && Number.isFinite(cycleDistance) && cycleDistance > 0
          ? distance / cycleDistance
          : Number.NaN;

      all.push({
        event: slice.event,
        category: slice.category,
        athlete,
        distance,
        time,
        speed,
        time25: toNumber(row25?.time_s),
        time50: toNumber(row50?.time_s),
        cycleTime,
        cycleDistance,
        cycleGlideTime,
        glideShare,
        wallPushGlideDistance,
        cyclesEstimate,
      });
    });
  });
  return all;
}

function eventSummaryRow(slice) {
  const totalRows = slice.bundle.total?.athletes || [];
  const rows = totalRows.map((row) => ({
    distance: toNumber(row.distance_m),
    speed: toNumber(row.avg_speed_mps),
  }));

  return {
    event: slice.event,
    category: slice.category,
    athletes: totalRows.length,
    longestDistance: maxValue(rows.map((row) => row.distance).filter(Number.isFinite)),
    medianDistance: median(rows.map((row) => row.distance).filter(Number.isFinite)),
    medianSpeed: median(rows.map((row) => row.speed).filter(Number.isFinite)),
  };
}

function topDistanceRows(rows, share = 0.15) {
  const valid = rows.filter((row) => Number.isFinite(row.distance)).sort(compareByDistanceThenTime);
  if (!valid.length) {
    return [];
  }
  const count = Math.max(5, Math.floor(valid.length * share));
  return valid.slice(0, count);
}

function renderKpis(summaryRows, athleteRows) {
  const container = document.getElementById("kpiGrid");
  if (!container) {
    return;
  }

  const uniqueEvents = new Set(summaryRows.map((row) => row.event));
  const uniqueAthletes = new Set(athleteRows.map((row) => row.athlete));

  const distances = athleteRows.map((row) => row.distance).filter(Number.isFinite);
  const fastest25 = minValue(athleteRows.map((row) => row.time25).filter(Number.isFinite));
  const fastest50 = minValue(athleteRows.map((row) => row.time50).filter(Number.isFinite));

  const longest = pickLongestRow(athleteRows);

  const rows = [
    { label: "Events", value: String(uniqueEvents.size) },
    { label: "Event Categories", value: String(summaryRows.length) },
    { label: "Athlete Entries", value: String(athleteRows.length) },
    { label: "Unique Athletes", value: String(uniqueAthletes.size) },
    { label: "Longest Distance", value: `${formatNumber(longest?.distance, 2)} m` },
    { label: "Best 25m", value: formatDuration(fastest25) },
    { label: "Best 50m", value: formatDuration(fastest50) },
    { label: "Median Distance", value: `${formatNumber(median(distances), 2)} m` },
  ];

  container.textContent = "";
  rows.forEach((row) => {
    const tile = document.createElement("article");
    tile.className = "kpi-tile";
    tile.innerHTML = `<p class="kpi-label">${row.label}</p><p class="kpi-value">${row.value}</p>`;
    container.appendChild(tile);
  });
}

function renderPerformanceAnswers(rows) {
  const container = document.getElementById("performanceAnswers");
  if (!container) {
    return;
  }

  const longest = pickLongestRow(rows);
  const topRows = topDistanceRows(rows, 0.15);
  const topSpeeds = topRows.map((row) => row.speed).filter(Number.isFinite);
  const topPacePer25 = topRows
    .map((row) => (Number.isFinite(row.time) && Number.isFinite(row.distance) && row.distance > 0 ? (row.time / row.distance) * 25 : Number.NaN))
    .filter(Number.isFinite);

  const cards = [
    {
      label: "Longest Distance + Associated Time",
      value: longest ? `${formatNumber(longest.distance, 2)} m in ${formatDuration(longest.time)}` : "-",
    },
    {
      label: "Speed at Longest Distance",
      value: longest ? `${formatNumber(longest.speed, 3)} m/s` : "-",
    },
    {
      label: "Median Speed (Top 15% Distances)",
      value: `${formatNumber(median(topSpeeds), 3)} m/s`,
    },
    {
      label: "Median 25m Split Pace (Top Distances)",
      value: `${formatDuration(median(topPacePer25))}`,
    },
  ];

  container.textContent = "";
  cards.forEach((card) => {
    const tile = document.createElement("article");
    tile.className = "kpi-tile";
    tile.innerHTML = `<p class="kpi-label">${card.label}</p><p class="kpi-value">${card.value}</p>`;
    container.appendChild(tile);
  });
}

function renderMilestones(rows) {
  const status = document.getElementById("milestoneStatus");
  const container = document.getElementById("milestoneTable");
  if (!container) {
    return;
  }

  const topRows = topDistanceRows(rows, 0.2);
  const pacePerM = topRows
    .map((row) => (Number.isFinite(row.time) && Number.isFinite(row.distance) && row.distance > 0 ? row.time / row.distance : Number.NaN))
    .filter(Number.isFinite);
  const basePace = median(pacePerM);

  const actual25 = median(topRows.map((row) => row.time25).filter(Number.isFinite));
  const actual50 = median(topRows.map((row) => row.time50).filter(Number.isFinite));

  const milestones = [25, 50, 75, 100, 125, 150, 175, 200].map((distance) => {
    let targetTime = Number.NaN;
    let source = "insufficient data";

    if (distance === 25 && Number.isFinite(actual25)) {
      targetTime = actual25;
      source = "actual 25m median";
    } else if (distance === 50 && Number.isFinite(actual50)) {
      targetTime = actual50;
      source = "actual 50m median";
    } else if (Number.isFinite(basePace)) {
      targetTime = basePace * distance;
      source = "pace projection";
    }

    const split25 = Number.isFinite(targetTime) ? (targetTime / distance) * 25 : Number.NaN;
    return { distance, targetTime, split25, source };
  });

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Milestone</th>
          <th>Target Time</th>
          <th>Target 25m Split</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        ${milestones
          .map(
            (row) => `
          <tr>
            <td>${row.distance} m</td>
            <td>${formatDuration(row.targetTime)}</td>
            <td>${formatDuration(row.split25)}</td>
            <td>${row.source}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  if (status) {
    status.textContent = "Suggested milestone targets are derived from the top 20% longest-distance entries across events.";
  }
}

function scaleLinear(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (!Number.isFinite(value) || !Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax === domainMin) {
    return (rangeMin + rangeMax) / 2;
  }
  const ratio = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + ratio * (rangeMax - rangeMin);
}

function renderScatterPlot({ containerId, points, xLabel, yLabel }) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.textContent = "";
  if (!points.length) {
    container.innerHTML = '<p class="note">Not enough data points for this relationship.</p>';
    return;
  }

  const width = 360;
  const height = 240;
  const padding = { top: 16, right: 14, bottom: 34, left: 42 };

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);

  const svgParts = [];
  svgParts.push(`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${xLabel} vs ${yLabel}">`);
  svgParts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#f7fbff" />`);
  svgParts.push(`<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#93b9d5" stroke-width="1" />`);
  svgParts.push(`<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#93b9d5" stroke-width="1" />`);

  points.forEach((point) => {
    const x = scaleLinear(point.x, xMin, xMax, padding.left, width - padding.right);
    const y = scaleLinear(point.y, yMin, yMax, height - padding.bottom, padding.top);
    const tooltip = `${point.label} · x=${point.x.toFixed(2)} y=${point.y.toFixed(2)}`;
    svgParts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.2" fill="#177ec7"><title>${tooltip}</title></circle>`);
  });

  svgParts.push(`<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#496178">${xLabel}</text>`);
  svgParts.push(`<text x="12" y="${height / 2}" transform="rotate(-90 12 ${height / 2})" text-anchor="middle" font-size="11" fill="#496178">${yLabel}</text>`);
  svgParts.push("</svg>");

  container.innerHTML = svgParts.join("");
}

function renderTechnique(rows) {
  const status = document.getElementById("techniqueStatus");

  const cycleGlidePoints = rows
    .filter((row) => Number.isFinite(row.distance) && Number.isFinite(row.glideShare))
    .map((row) => ({
      x: row.distance,
      y: row.glideShare,
      label: `${row.athlete} (${row.event}/${row.category})`,
    }));

  const wallPushPoints = rows
    .filter((row) => Number.isFinite(row.distance) && Number.isFinite(row.wallPushGlideDistance))
    .map((row) => ({
      x: row.distance,
      y: row.wallPushGlideDistance,
      label: `${row.athlete} (${row.event}/${row.category})`,
    }));

  const cyclesPoints = rows
    .filter((row) => Number.isFinite(row.distance) && Number.isFinite(row.cyclesEstimate))
    .map((row) => ({
      x: row.distance,
      y: row.cyclesEstimate,
      label: `${row.athlete} (${row.event}/${row.category})`,
    }));

  renderScatterPlot({
    containerId: "cycleGlideChart",
    points: cycleGlidePoints,
    xLabel: "Total Distance (m)",
    yLabel: "Cycle Glide Share",
  });

  renderScatterPlot({
    containerId: "wallPushChart",
    points: wallPushPoints,
    xLabel: "Total Distance (m)",
    yLabel: "Wall Push Glide Distance (m)",
  });

  renderScatterPlot({
    containerId: "cyclesChart",
    points: cyclesPoints,
    xLabel: "Total Distance (m)",
    yLabel: "Estimated Cycles",
  });

  const table = document.getElementById("techniqueTable");
  if (table) {
    const top = rows
      .filter((row) => Number.isFinite(row.distance))
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 12);

    table.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Athlete</th>
            <th>Event</th>
            <th>Category</th>
            <th>Total Distance (m)</th>
            <th>Cycle Time (s)</th>
            <th>Cycle Glide Share</th>
            <th>Wall Push Glide (m)</th>
            <th>Estimated Cycles</th>
          </tr>
        </thead>
        <tbody>
          ${top
            .map(
              (row) => `
            <tr>
              <td>${row.athlete}</td>
              <td>${row.event}</td>
              <td>${row.category}</td>
              <td>${formatNumber(row.distance, 2)}</td>
              <td>${formatNumber(row.cycleTime, 2)}</td>
              <td>${formatPercent(row.glideShare, 1)}</td>
              <td>${formatNumber(row.wallPushGlideDistance, 2)}</td>
              <td>${formatNumber(row.cyclesEstimate, 1)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  if (status) {
    status.textContent = `Technique relationships across all event/category athlete entries. Points: glide share ${cycleGlidePoints.length}, wall push ${wallPushPoints.length}, cycle count ${cyclesPoints.length}.`;
  }
}

function renderEventTable(summaryRows) {
  const container = document.getElementById("eventTable");
  if (!container) {
    return;
  }

  const ordered = [...summaryRows].sort((a, b) => {
    const eventCmp = a.event.localeCompare(b.event);
    if (eventCmp !== 0) {
      return eventCmp;
    }
    return a.category.localeCompare(b.category);
  });

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Event</th>
          <th>Category</th>
          <th>Athletes</th>
          <th>Longest Distance (m)</th>
          <th>Median Distance (m)</th>
          <th>Median Speed (m/s)</th>
          <th>Open Event Explorer</th>
        </tr>
      </thead>
      <tbody>
        ${ordered
          .map(
            (row) => `
          <tr>
            <td>${row.event}</td>
            <td>${row.category}</td>
            <td>${row.athletes}</td>
            <td>${formatNumber(row.longestDistance, 2)}</td>
            <td>${formatNumber(row.medianDistance, 2)}</td>
            <td>${formatNumber(row.medianSpeed, 3)}</td>
            <td><a href="../events/?event=${encodeURIComponent(row.event)}&category=${encodeURIComponent(row.category)}">Event Explorer</a></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function toPortalAssetPath(path) {
  if (typeof path !== "string" || !path.trim()) {
    return "";
  }
  const normalized = path.trim();
  if (normalized.startsWith("data/")) {
    return `../../${normalized}`;
  }
  return normalized;
}

function placeholderDistributionEntries() {
  return [
    {
      key: "distance-cross-event-1d",
      label: "Total Distance Distribution",
      note: "Expected aggregated density/histogram across all event categories.",
    },
    {
      key: "speed-cross-event-1d",
      label: "Total Speed Distribution",
      note: "Expected pooled speed distribution aligned with Overview KPIs.",
    },
    {
      key: "impulse-cross-event-1d",
      label: "Total Impulse Distribution",
      note: "Expected pooled impulse distribution across event categories.",
    },
  ];
}

function renderCrossEventDistributions(manifest) {
  const container = document.getElementById("crossEventDistributionGallery");
  const status = document.getElementById("crossEventDistributionStatus");
  if (!container) {
    return;
  }

  container.textContent = "";

  const entries = (manifest.cross_event_distributions?.DNF || []).filter((entry) => entry && typeof entry === "object");
  const availableEntries = entries.filter((entry) => typeof entry.path === "string" && entry.path.trim());

  if (!availableEntries.length) {
    placeholderDistributionEntries().forEach((entry) => {
      const figure = document.createElement("article");
      figure.className = "figure-card";
      figure.innerHTML = `
        <p class="kpi-label">Placeholder</p>
        <h3>${entry.label}</h3>
        <p class="note">${entry.note}</p>
        <p class="note mono">expected key: ${entry.key}</p>
      `;
      container.appendChild(figure);
    });

    if (status) {
      status.textContent = "No cross-event distribution artifacts found yet. Showing consumer-contract placeholders.";
    }
    return;
  }

  availableEntries.forEach((entry) => {
    const figure = document.createElement("figure");
    figure.className = "figure-card";
    const label = entry.label || entry.key || "Cross-event distribution";
    figure.innerHTML = `
      <img src="${toPortalAssetPath(entry.path)}" alt="${label}" loading="lazy" />
      <figcaption class="figure-caption">${label}</figcaption>
    `;
    container.appendChild(figure);
  });

  if (status) {
    status.textContent = `Showing ${availableEntries.length} cross-event distribution artifact(s).`;
  }
}

async function main() {
  const status = document.getElementById("overviewStatus");
  if (status) {
    status.textContent = "Loading discipline-wide aggregate overview...";
  }

  try {
    const manifest = await loadManifest();
    const slices = await loadSlices(manifest);
    const summaryRows = slices.map((slice) => eventSummaryRow(slice));
    const athleteRows = flattenAthleteRows(slices);

    renderKpis(summaryRows, athleteRows);
    renderPerformanceAnswers(athleteRows);
    renderMilestones(athleteRows);
    renderTechnique(athleteRows);
    renderEventTable(summaryRows);
    renderCrossEventDistributions(manifest);

    if (status) {
      status.textContent = `Showing discipline-wide aggregate overview across ${summaryRows.length} event category slice(s).`;
    }
  } catch (error) {
    if (status) {
      status.textContent = `Failed to load aggregate overview: ${error.message}`;
    }
  }
}

main();
