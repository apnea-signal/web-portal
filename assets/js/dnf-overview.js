import { fetchJson, loadManifest } from "./data.js";

const SIDEBAR_MIN_WIDTH = 380;
const SIDEBAR_MAX_WIDTH = 860;
const DEFAULT_TABLE_PAGE_SIZE = 10;
const OVERLAY_LINE_COLORS = ["#0f1824", "#1a3250", "#243e2a", "#4a2b25", "#3a2b5a", "#42510f"];
const TECHNIQUE_CHARTS = [
  {
    id: "wall_push_glide_2d_25m",
    title: "Wall Push Glide",
    subtitle: "Distance and glide time from the wall push",
    filename: "wall-push-glide-2d-25m.png",
    xField: "technique_wall_push_glide_distance_m",
    yField: "technique_wall_push_glide_time_s",
  },
  {
    id: "cycle_glide_2d_25m",
    title: "Cycle Glide",
    subtitle: "Distance and glide time for a leg kick plus arm pull cycle",
    filename: "cycle-glide-2d-25m.png",
    xField: "technique_cycle_glide_distance_m",
    yField: "technique_cycle_glide_time_s",
  },
  {
    id: "leg_kick_glide_2d_50m",
    title: "Leg Kick Glide",
    subtitle: "Distance and glide time for the leg kick only",
    filename: "leg-kick-glide-2d-50m.png",
    xField: "technique_leg_kick_glide_distance_m",
    yField: "technique_leg_kick_glide_time_s",
  },
];

function slugToLabel(slug) {
  return String(slug || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
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

function getSpeedProfileOverlayJsonPath(categoryEntry) {
  const explicit = String(categoryEntry?.speed_profile_overlay_path || "").trim();
  if (explicit) {
    return explicit;
  }

  const chartPath = String(categoryEntry?.speed_profile_chart || "").trim();
  if (!chartPath.endsWith(".png")) {
    return "";
  }
  return chartPath.replace(/\.png$/i, ".overlay.json");
}

async function loadOverlayMetadata(path) {
  if (!path) {
    return null;
  }
  try {
    const payload = await fetchJson(path);
    return normalizeOverlayMetadata(payload);
  } catch {
    return null;
  }
}

function defaultAnalysisChartPath(categoryId, filename) {
  return `data/analysis/DNF/${categoryId}/charts/${filename}`;
}

function getTechniqueChartEntries(categoryEntry) {
  const categoryId = String(categoryEntry?.id || "").trim();
  const configuredCharts = categoryEntry?.technique_charts || {};
  return TECHNIQUE_CHARTS.map((chart) => {
    const configured = configuredCharts?.[chart.id] || {};
    const configuredChartPath = String(configured?.chart_path || "").trim();
    const chartPath = configuredChartPath || defaultAnalysisChartPath(categoryId, chart.filename);
    const configuredOverlayPath = String(configured?.overlay_path || "").trim();
    const overlayPath =
      configuredOverlayPath || (chartPath.endsWith(".png") ? chartPath.replace(/\.png$/i, ".overlay.json") : "");
    return {
      ...chart,
      chartPath,
      overlayPath,
    };
  });
}

function getRequestedCategory() {
  const params = new URLSearchParams(window.location.search);
  return params.get("category") || "";
}

function updateCategoryQuery(category) {
  const params = new URLSearchParams(window.location.search);
  if (category) {
    params.set("category", category);
  } else {
    params.delete("category");
  }
  params.delete("event");
  params.delete("stream");
  const query = params.toString();
  history.replaceState({}, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "-";
  }
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const sec = rounded - minutes * 60;
  return `${minutes}:${String(sec).padStart(2, "0")}`;
}

function toPerformanceNumber(value) {
  if (value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function formatPerformance(value) {
  const number = toPerformanceNumber(value);
  return Number.isFinite(number) ? `${Math.round(number)} m` : "-";
}

function formatSpeed(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} m/s` : "-";
}

function formatDistance(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} m` : "-";
}

function formatSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} s` : "-";
}

function rowKey(row) {
  return `${row.event}::${row.athlete_slug}`;
}

function normalizeOverlayMetadata(payload) {
  const schemaVersion = String(payload?.schema_version || "").trim();
  if (!schemaVersion.startsWith("2.")) {
    return null;
  }

  const normalized = payload?.plot_area?.normalized || {};
  const left = Number(normalized.left);
  const top = Number(normalized.top);
  const right = Number(normalized.right);
  const bottom = Number(normalized.bottom);
  const xMin = Number(payload?.axes?.x?.min);
  const xMax = Number(payload?.axes?.x?.max);
  const yMin = Number(payload?.axes?.y?.min);
  const yMax = Number(payload?.axes?.y?.max);

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(xMin) ||
    !Number.isFinite(xMax) ||
    !Number.isFinite(yMin) ||
    !Number.isFinite(yMax) ||
    right <= left ||
    bottom <= top ||
    xMax <= xMin ||
    yMax <= yMin
  ) {
    return null;
  }

  return {
    plotNormalized: { left, top, right, bottom },
    axes: { xMin, xMax, yMin, yMax },
  };
}

function normalizeSpeedProfilePoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  const normalized = [];
  points.forEach((point) => {
    if (!point || typeof point !== "object") {
      return;
    }
    const distance = Number(point.distance_m);
    const time = Number(point.time_s);
    if (!Number.isFinite(distance) || !Number.isFinite(time) || time <= 0) {
      return;
    }
    normalized.push({ distance_m: distance, time_s: time });
  });

  normalized.sort((a, b) => (a.distance_m !== b.distance_m ? a.distance_m - b.distance_m : a.time_s - b.time_s));
  return normalized;
}

function projectOverlayPoint(point, overlayMetadata, width, height) {
  if (!overlayMetadata || !point) {
    return null;
  }

  const { plotNormalized, axes } = overlayMetadata;
  const plotLeft = plotNormalized.left * width;
  const plotTop = plotNormalized.top * height;
  const plotRight = plotNormalized.right * width;
  const plotBottom = plotNormalized.bottom * height;

  const tx = (point.distance_m - axes.xMin) / (axes.xMax - axes.xMin);
  const ty = (point.time_s - axes.yMin) / (axes.yMax - axes.yMin);

  return {
    x: plotLeft + tx * (plotRight - plotLeft),
    y: plotBottom - ty * (plotBottom - plotTop),
    plotLeft,
    plotTop,
    plotRight,
    plotBottom,
  };
}

function overlayPathData(projectedPoints) {
  if (!projectedPoints.length) {
    return "";
  }
  const [first, ...rest] = projectedPoints;
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest
    .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ")}`;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointInRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function rectsIntersect(a, b) {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}

function cross(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax, ay, bx, by, cx, cy) {
  return (
    Math.min(ax, bx) <= cx &&
    cx <= Math.max(ax, bx) &&
    Math.min(ay, by) <= cy &&
    cy <= Math.max(ay, by)
  );
}

function segmentsIntersect(segA, segB) {
  const x1 = segA.x1;
  const y1 = segA.y1;
  const x2 = segA.x2;
  const y2 = segA.y2;
  const x3 = segB.x1;
  const y3 = segB.y1;
  const x4 = segB.x2;
  const y4 = segB.y2;

  const d1 = cross(x1, y1, x2, y2, x3, y3);
  const d2 = cross(x1, y1, x2, y2, x4, y4);
  const d3 = cross(x3, y3, x4, y4, x1, y1);
  const d4 = cross(x3, y3, x4, y4, x2, y2);

  if (d1 === 0 && onSegment(x1, y1, x2, y2, x3, y3)) {
    return true;
  }
  if (d2 === 0 && onSegment(x1, y1, x2, y2, x4, y4)) {
    return true;
  }
  if (d3 === 0 && onSegment(x3, y3, x4, y4, x1, y1)) {
    return true;
  }
  if (d4 === 0 && onSegment(x3, y3, x4, y4, x2, y2)) {
    return true;
  }

  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

function segmentIntersectsRect(segment, rect) {
  const p1 = { x: segment.x1, y: segment.y1 };
  const p2 = { x: segment.x2, y: segment.y2 };
  if (pointInRect(p1, rect) || pointInRect(p2, rect)) {
    return true;
  }

  const edges = [
    { x1: rect.left, y1: rect.top, x2: rect.right, y2: rect.top },
    { x1: rect.right, y1: rect.top, x2: rect.right, y2: rect.bottom },
    { x1: rect.right, y1: rect.bottom, x2: rect.left, y2: rect.bottom },
    { x1: rect.left, y1: rect.bottom, x2: rect.left, y2: rect.top },
  ];
  return edges.some((edge) => segmentsIntersect(segment, edge));
}

function connectorSegmentToRect(anchorPoint, rect, side) {
  const targetY = clampNumber(anchorPoint.y, rect.top + 3, rect.bottom - 3);
  const targetX = side === "right" ? rect.left : rect.right;
  return {
    x1: anchorPoint.x,
    y1: anchorPoint.y,
    x2: targetX,
    y2: targetY,
  };
}

function renderOverlayLabels({ svgElement, labelItems, guideSegments, width, plotTop, plotBottom }) {
  if (!labelItems.length) {
    return;
  }

  const svgNs = "http://www.w3.org/2000/svg";
  const labelsGroup = document.createElementNS(svgNs, "g");
  svgElement.appendChild(labelsGroup);

  const labelTop = plotTop + 12;
  const labelBottom = plotBottom - 12;
  const labelSpacing = 22;
  const labelGapFromPoint = 14;
  const placedLabelRects = [];
  const placedConnectorSegments = [];
  [...labelItems]
    .sort((a, b) => a.y - b.y)
    .forEach((label) => {
      const estimatedWidth = Math.max(label.nameText.length, label.metaText.length) * 7.1 + 18;
      const estimatedHeight = 28;
      const candidateYOffset = [0, -labelSpacing, labelSpacing, -2 * labelSpacing, 2 * labelSpacing];
      const candidateXOffset = [0, 18, 34];
      const candidateSides = ["right", "left"];
      const preferredY = clampNumber(label.y, labelTop, labelBottom);
      let bestCandidate = null;

      candidateSides.forEach((side) => {
        candidateXOffset.forEach((xOffset) => {
          const idealX =
            side === "right"
              ? label.x + labelGapFromPoint + xOffset
              : label.x - labelGapFromPoint - xOffset - estimatedWidth;
          const clampedX = clampNumber(idealX, 6, Math.max(6, width - estimatedWidth - 6));

          candidateYOffset.forEach((offset) => {
            const y = clampNumber(preferredY + offset, labelTop, labelBottom);
            const rect = {
              left: clampedX - 4,
              top: y - 2,
              right: clampedX - 4 + estimatedWidth + 8,
              bottom: y - 2 + estimatedHeight,
            };
            const connector = connectorSegmentToRect(label, rect, side);

            const guideHits = guideSegments.reduce(
              (count, segment) => count + (segmentIntersectsRect(segment, rect) ? 1 : 0),
              0
            );
            const connectorHits = placedConnectorSegments.reduce(
              (count, segment) => count + (segmentIntersectsRect(segment, rect) ? 1 : 0),
              0
            );
            const labelHits = placedLabelRects.reduce(
              (count, existing) => count + (rectsIntersect(existing, rect) ? 1 : 0),
              0
            );
            const endpointCovered = pointInRect(label, rect) ? 1 : 0;
            const connectorThroughLabels = placedLabelRects.reduce(
              (count, existing) => count + (segmentIntersectsRect(connector, existing) ? 1 : 0),
              0
            );
            const connectorCrosses = placedConnectorSegments.reduce(
              (count, segment) => count + (segmentsIntersect(connector, segment) ? 1 : 0),
              0
            );
            const connectorLength = Math.hypot(connector.x2 - connector.x1, connector.y2 - connector.y1);

            const score =
              guideHits * 1100 +
              connectorHits * 900 +
              labelHits * 1000 +
              endpointCovered * 1300 +
              connectorThroughLabels * 320 +
              connectorCrosses * 1500 +
              connectorLength * 0.18 +
              Math.abs(offset) * 0.7 +
              xOffset * 0.35 +
              (side === "left" ? 1 : 0);

            if (!bestCandidate || score < bestCandidate.score) {
              bestCandidate = { side, x: clampedX, y, score };
            }
          });
        });
      });

      if (!bestCandidate) {
        return;
      }

      const text = document.createElementNS(svgNs, "text");
      text.setAttribute("x", bestCandidate.x.toFixed(2));
      text.setAttribute("y", bestCandidate.y.toFixed(2));
      text.setAttribute("font-size", "11.5");
      text.setAttribute("dominant-baseline", "hanging");
      text.setAttribute("fill", "#1f2b37");
      const nameLine = document.createElementNS(svgNs, "tspan");
      nameLine.setAttribute("x", bestCandidate.x.toFixed(2));
      nameLine.setAttribute("dy", "0");
      nameLine.setAttribute("font-weight", "700");
      nameLine.textContent = label.nameText;
      text.appendChild(nameLine);

      const metaLine = document.createElementNS(svgNs, "tspan");
      metaLine.setAttribute("x", bestCandidate.x.toFixed(2));
      metaLine.setAttribute("dy", "13");
      metaLine.setAttribute("font-weight", "600");
      metaLine.textContent = label.metaText;
      text.appendChild(metaLine);
      labelsGroup.appendChild(text);

      const bbox = text.getBBox();
      const bg = document.createElementNS(svgNs, "rect");
      bg.setAttribute("x", (bbox.x - 4).toFixed(2));
      bg.setAttribute("y", (bbox.y - 2).toFixed(2));
      bg.setAttribute("width", (bbox.width + 8).toFixed(2));
      bg.setAttribute("height", (bbox.height + 4).toFixed(2));
      bg.setAttribute("rx", "3");
      bg.setAttribute("ry", "3");
      bg.setAttribute("fill", "rgba(241, 245, 248, 0.92)");
      bg.setAttribute("stroke", "#4d5966");
      bg.setAttribute("stroke-width", "0.8");
      labelsGroup.insertBefore(bg, text);

      const boxLeft = bbox.x - 4;
      const boxRight = bbox.x + bbox.width + 4;
      const boxTop = bbox.y - 2;
      const boxBottom = bbox.y + bbox.height + 2;
      const connectorTargetX = bestCandidate.side === "right" ? boxLeft : boxRight;
      const connectorTargetY = Math.max(boxTop + 3, Math.min(label.y, boxBottom - 3));

      const connector = document.createElementNS(svgNs, "line");
      connector.setAttribute("x1", label.x.toFixed(2));
      connector.setAttribute("y1", label.y.toFixed(2));
      connector.setAttribute("x2", connectorTargetX.toFixed(2));
      connector.setAttribute("y2", connectorTargetY.toFixed(2));
      connector.setAttribute("stroke", label.color);
      connector.setAttribute("stroke-width", "1.25");
      connector.setAttribute("stroke-linecap", "round");
      connector.setAttribute("opacity", "0.82");
      labelsGroup.insertBefore(connector, text);

      placedLabelRects.push({
        left: boxLeft,
        top: boxTop,
        right: boxRight,
        bottom: boxBottom,
      });
      placedConnectorSegments.push({
        x1: label.x,
        y1: label.y,
        x2: connectorTargetX,
        y2: connectorTargetY,
      });
    });
}

function renderSpeedProfileOverlay({ rows, selectedKeys, overlayMetadata, imageElement, svgElement }) {
  if (!svgElement) {
    return;
  }

  svgElement.replaceChildren();
  if (!overlayMetadata || !imageElement) {
    return;
  }

  const bounds = imageElement.getBoundingClientRect();
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return;
  }

  svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const selectedRows = rows.filter((row) => selectedKeys.has(rowKey(row)));
  if (!selectedRows.length) {
    return;
  }

  const firstProjectPoint = projectOverlayPoint({ distance_m: 0, time_s: 1 }, overlayMetadata, width, height);
  if (!firstProjectPoint) {
    return;
  }

  const svgNs = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(svgNs, "defs");
  const clipPath = document.createElementNS(svgNs, "clipPath");
  clipPath.setAttribute("id", "speedProfilePlotClip");
  const clipRect = document.createElementNS(svgNs, "rect");
  clipRect.setAttribute("x", firstProjectPoint.plotLeft.toFixed(2));
  clipRect.setAttribute("y", firstProjectPoint.plotTop.toFixed(2));
  clipRect.setAttribute("width", (firstProjectPoint.plotRight - firstProjectPoint.plotLeft).toFixed(2));
  clipRect.setAttribute("height", (firstProjectPoint.plotBottom - firstProjectPoint.plotTop).toFixed(2));
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svgElement.appendChild(defs);

  const overlayGroup = document.createElementNS(svgNs, "g");
  overlayGroup.setAttribute("clip-path", "url(#speedProfilePlotClip)");
  svgElement.appendChild(overlayGroup);

  let colorIndex = 0;
  const labelItems = [];
  const guideSegments = [];
  selectedRows.forEach((row) => {
    const points = normalizeSpeedProfilePoints(row.speed_profile_points);
    if (points.length < 2) {
      return;
    }

    const projectedPoints = points
      .map((point) => projectOverlayPoint(point, overlayMetadata, width, height))
      .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
    if (projectedPoints.length < 2) {
      return;
    }

    const color = OVERLAY_LINE_COLORS[colorIndex % OVERLAY_LINE_COLORS.length];
    colorIndex += 1;

    for (let index = 1; index < projectedPoints.length; index += 1) {
      const previous = projectedPoints[index - 1];
      const current = projectedPoints[index];
      guideSegments.push({
        x1: previous.x,
        y1: previous.y,
        x2: current.x,
        y2: current.y,
      });
    }

    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", overlayPathData(projectedPoints));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-dasharray", "6 5");
    path.setAttribute("opacity", "0.92");
    overlayGroup.appendChild(path);

    projectedPoints.forEach((point) => {
      const marker = document.createElementNS(svgNs, "circle");
      marker.setAttribute("cx", point.x.toFixed(2));
      marker.setAttribute("cy", point.y.toFixed(2));
      marker.setAttribute("r", "3");
      marker.setAttribute("fill", color);
      marker.setAttribute("stroke", "#f7fbff");
      marker.setAttribute("stroke-width", "0.9");
      overlayGroup.appendChild(marker);
    });

    const endPoint = projectedPoints[projectedPoints.length - 1];
    const athleteName = String(row.athlete_name || row.athlete_slug || "Unknown");
    const speedMps = Number(row.speed_mps);
    const speedText = Number.isFinite(speedMps) ? `${speedMps.toFixed(2)} m/s` : "- m/s";
    labelItems.push({
      x: endPoint.x,
      y: endPoint.y,
      color,
      nameText: athleteName,
      metaText: speedText,
    });
  });

  if (!labelItems.length) {
    return;
  }
  renderOverlayLabels({
    svgElement,
    labelItems,
    guideSegments,
    width,
    plotTop: firstProjectPoint.plotTop,
    plotBottom: firstProjectPoint.plotBottom,
  });
}

function sortRows(rows, sortMode) {
  const ordered = [...rows];
  ordered.sort((a, b) => {
    const performanceA = toPerformanceNumber(a.performance_m);
    const performanceB = toPerformanceNumber(b.performance_m);
    const nameA = String(a.athlete_name || "");
    const nameB = String(b.athlete_name || "");

    if (sortMode === "performance_desc" || sortMode === "performance_asc") {
      const bothFinite = Number.isFinite(performanceA) && Number.isFinite(performanceB);
      if (bothFinite && performanceA !== performanceB) {
        return sortMode === "performance_desc" ? performanceB - performanceA : performanceA - performanceB;
      }
      if (Number.isFinite(performanceA) && !Number.isFinite(performanceB)) {
        return -1;
      }
      if (!Number.isFinite(performanceA) && Number.isFinite(performanceB)) {
        return 1;
      }
      const nameCompare = nameA.localeCompare(nameB);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return String(a.event || "").localeCompare(String(b.event || ""));
    }

    if (sortMode === "name_desc") {
      const cmp = nameB.localeCompare(nameA);
      if (cmp !== 0) {
        return cmp;
      }
      return performanceB - performanceA;
    }

    const cmp = nameA.localeCompare(nameB);
    if (cmp !== 0) {
      return cmp;
    }
    return performanceB - performanceA;
  });
  return ordered;
}

function renderSpeedProfileCard(container, categoryEntry) {
  const categoryId = categoryEntry?.id || "unknown";
  const chartPath = toPortalAssetPath(categoryEntry?.speed_profile_chart || "");

  const chartMarkup = chartPath
    ? `<figure class="speed-profile-figure">
         <div class="speed-profile-stage">
           <img id="speedProfileImage" src="${chartPath}" alt="Speed profile top athletes for ${slugToLabel(categoryId)}" loading="lazy" />
           <svg id="speedProfileOverlay" class="speed-profile-overlay" aria-hidden="true"></svg>
         </div>
         <figcaption class="figure-caption">Category: ${slugToLabel(categoryId)}</figcaption>
       </figure>`
    : `<div class="speed-profile-missing">
         <p class="note">Chart not available yet for ${slugToLabel(categoryId)}.</p>
       </div>`;

  container.innerHTML = `
    <article class="speed-profile-card">
      <div class="speed-profile-visual">${chartMarkup}</div>
      <div class="speed-profile-notes">
        <div class="table-wrap speed-reference-wrap">
          <table>
            <thead>
              <tr>
                <th>Athlete</th>
                <th>Speed</th>
                <th>Time to 25m</th>
                <th>Time to 50m</th>
                <th>Time to 100m</th>
              </tr>
            </thead>
            <tbody id="speedProfileSplitTableBody">
              <tr><td colspan="5" class="note">Loading athlete splits...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </article>
  `;
}

function renderSpeedProfileSplitTable(rows, selectedKeys) {
  const tbody = document.getElementById("speedProfileSplitTableBody");
  if (!tbody) {
    return;
  }

  const selectedRows = rows.filter((row) => selectedKeys.has(rowKey(row)));
  if (!selectedRows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="note">No selected athletes.</td></tr>';
    return;
  }

  const orderedRows = sortRows(selectedRows, "performance_desc");
  tbody.innerHTML = orderedRows
    .map((row) => {
      const name = String(row.athlete_name || row.athlete_slug || "Unknown");
      const speed = formatSpeed(row.speed_mps);
      const time25 = formatDuration(Number(row.time_25m_s));
      const time50 = formatDuration(Number(row.time_50m_s));
      const time100 = formatDuration(Number(row.time_100m_s));
      return `
        <tr>
          <td>${name}</td>
          <td>${speed}</td>
          <td>${time25}</td>
          <td>${time50}</td>
          <td>${time100}</td>
        </tr>
      `;
    })
    .join("");
}

function renderTechniqueSection(container, categoryEntry) {
  if (!container) {
    return [];
  }
  const categoryId = String(categoryEntry?.id || "unknown");
  const chartEntries = getTechniqueChartEntries(categoryEntry);
  const chartsMarkup = chartEntries
    .map((chart) => {
      const chartPath = toPortalAssetPath(chart.chartPath);
      if (!chartPath) {
        return `
          <article class="technique-chart-card">
            <h3>${chart.title}</h3>
            <p class="note">${chart.subtitle}</p>
            <div class="speed-profile-missing">
              <p class="note">Chart not available yet for ${slugToLabel(categoryId)}.</p>
            </div>
            <p class="note technique-chart-summary">No chart asset published.</p>
          </article>
        `;
      }

      return `
        <article class="technique-chart-card">
          <h3>${chart.title}</h3>
          <p class="note">${chart.subtitle}</p>
          <figure class="speed-profile-figure">
            <div class="speed-profile-stage">
              <img
                data-technique-chart-image="${chart.id}"
                src="${chartPath}"
                alt="${chart.title} scatter for ${slugToLabel(categoryId)}"
                loading="lazy"
              />
              <svg data-technique-chart-overlay="${chart.id}" class="speed-profile-overlay" aria-hidden="true"></svg>
            </div>
          </figure>
          <p data-technique-chart-summary="${chart.id}" class="note technique-chart-summary">
            No selected athletes with required values.
          </p>
        </article>
      `;
    })
    .join("");

  container.innerHTML = `
    <article class="technique-strips-card">
      <h3>Athelete Technique Breakdown for the first 50m</h3>
      <p class="note">Selected athletes event phases from propulsion refined outputs.</p>
      <div id="techniqueEventStripList" class="technique-strip-list">
        <p class="note">No selected athletes.</p>
      </div>
    </article>
    <div class="technique-grid">${chartsMarkup}</div>
  `;
  return chartEntries;
}

function renderTechniqueChartOverlay({ rows, selectedKeys, chartState }) {
  const svgElement = chartState?.svgElement;
  if (!svgElement) {
    return;
  }

  svgElement.replaceChildren();
  const imageElement = chartState?.imageElement;
  const overlayMetadata = chartState?.overlayMetadata;
  const summaryElement = chartState?.summaryElement;
  if (!imageElement || !overlayMetadata) {
    if (summaryElement) {
      summaryElement.textContent = "Overlay metadata unavailable.";
    }
    return;
  }

  const bounds = imageElement.getBoundingClientRect();
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    if (summaryElement) {
      summaryElement.textContent = "Waiting for chart layout...";
    }
    return;
  }
  svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const firstProjectPoint = projectOverlayPoint(
    { distance_m: overlayMetadata.axes.xMin, time_s: overlayMetadata.axes.yMin },
    overlayMetadata,
    width,
    height
  );
  if (!firstProjectPoint) {
    if (summaryElement) {
      summaryElement.textContent = "Overlay bounds unavailable.";
    }
    return;
  }

  const svgNs = "http://www.w3.org/2000/svg";
  const clipId = `techniquePlotClip-${chartState.id}`;
  const defs = document.createElementNS(svgNs, "defs");
  const clipPath = document.createElementNS(svgNs, "clipPath");
  clipPath.setAttribute("id", clipId);
  const clipRect = document.createElementNS(svgNs, "rect");
  clipRect.setAttribute("x", firstProjectPoint.plotLeft.toFixed(2));
  clipRect.setAttribute("y", firstProjectPoint.plotTop.toFixed(2));
  clipRect.setAttribute("width", (firstProjectPoint.plotRight - firstProjectPoint.plotLeft).toFixed(2));
  clipRect.setAttribute("height", (firstProjectPoint.plotBottom - firstProjectPoint.plotTop).toFixed(2));
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svgElement.appendChild(defs);

  const overlayGroup = document.createElementNS(svgNs, "g");
  overlayGroup.setAttribute("clip-path", `url(#${clipId})`);
  svgElement.appendChild(overlayGroup);

  const selectedRows = sortRows(
    rows.filter((row) => selectedKeys.has(rowKey(row))),
    "performance_desc"
  );
  const labelItems = [];
  let colorIndex = 0;
  selectedRows.forEach((row) => {
    const xValue = Number(row[chartState.xField]);
    const yValue = Number(row[chartState.yField]);
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) {
      return;
    }

    const projected = projectOverlayPoint({ distance_m: xValue, time_s: yValue }, overlayMetadata, width, height);
    if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      return;
    }

    const color = OVERLAY_LINE_COLORS[colorIndex % OVERLAY_LINE_COLORS.length];
    colorIndex += 1;
    const marker = document.createElementNS(svgNs, "circle");
    marker.setAttribute("cx", projected.x.toFixed(2));
    marker.setAttribute("cy", projected.y.toFixed(2));
    marker.setAttribute("r", "4.2");
    marker.setAttribute("fill", color);
    marker.setAttribute("stroke", "#f7fbff");
    marker.setAttribute("stroke-width", "1.2");
    marker.setAttribute("opacity", "0.95");
    overlayGroup.appendChild(marker);

    labelItems.push({
      x: projected.x,
      y: projected.y,
      color,
      nameText: String(row.athlete_name || row.athlete_slug || "Unknown"),
      metaText: `${formatDistance(xValue)} · ${formatSeconds(yValue)}`,
    });
  });

  if (summaryElement) {
    summaryElement.textContent = labelItems.length
      ? `Overlaying ${labelItems.length} selected athlete(s).`
      : "No selected athletes with required values.";
  }

  renderOverlayLabels({
    svgElement,
    labelItems,
    guideSegments: [],
    width,
    plotTop: firstProjectPoint.plotTop,
    plotBottom: firstProjectPoint.plotBottom,
  });
}

function renderTechniqueEventStrips(rows, selectedKeys) {
  const container = document.getElementById("techniqueEventStripList");
  if (!container) {
    return;
  }

  const selectedRows = sortRows(
    rows.filter((row) => selectedKeys.has(rowKey(row))),
    "performance_desc"
  );
  if (!selectedRows.length) {
    container.innerHTML = '<p class="note">No selected athletes.</p>';
    return;
  }

  container.innerHTML = selectedRows
    .map((row) => {
      const name = String(row.athlete_name || row.athlete_slug || "Unknown");
      const stripPath = toPortalAssetPath(String(row.event_strip_path || ""));
      const stripMarkup = stripPath
        ? `<img src="${stripPath}" alt="${name} propulsion event strip" loading="lazy" />`
        : '<div class="technique-strip-missing"><p class="note">Event strip not available.</p></div>';
      return `
        <article class="technique-strip-card">
          <h4 class="technique-strip-name">${name}</h4>
          ${stripMarkup}
        </article>
      `;
    })
    .join("");
}

function uniqueEvents(rows) {
  return [...new Set(rows.map((row) => String(row.event || "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function buildEventTypeByEventId(manifest) {
  const map = new Map();
  (manifest?.events || []).forEach((eventRow) => {
    const eventId = String(eventRow?.id || "").trim();
    if (!eventId) {
      return;
    }
    const eventType = String(eventRow?.event_type || "competition").trim().toLowerCase();
    map.set(eventId, eventType || "competition");
  });
  return map;
}

function splitEventsByType(availableEvents, eventTypeByEventId) {
  const trainingEvents = availableEvents.filter((eventId) => eventTypeByEventId.get(eventId) === "training");
  const topEvents = availableEvents.filter((eventId) => eventTypeByEventId.get(eventId) !== "training");
  return { topEvents, trainingEvents };
}

function applyFiltersAndSort(rows, selectedTopEventIds, selectedTrainingEventIds, sortMode) {
  const mergedEventIds = new Set([...selectedTopEventIds, ...selectedTrainingEventIds]);
  const filtered = mergedEventIds.size
    ? rows.filter((row) => mergedEventIds.has(String(row.event || "")))
    : [];
  return sortRows(filtered, sortMode);
}

function filterRowsByName(rows, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) {
    return rows;
  }
  return rows.filter((row) => {
    const name = String(row.athlete_name || row.athlete_slug || "").toLowerCase();
    return name.includes(normalized);
  });
}

function paginateRows(rows, page, pageSize) {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : DEFAULT_TABLE_PAGE_SIZE;
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  const endIndex = startIndex + safePageSize;
  return {
    pageRows: rows.slice(startIndex, endIndex),
    currentPage,
    totalPages,
    totalRows,
    startIndex,
    endIndex: Math.min(endIndex, totalRows),
    pageSize: safePageSize,
  };
}

function applyTop5Preset(rows, selectedKeys) {
  selectedKeys.clear();
  const topRows = sortRows(rows, "performance_desc").slice(0, 5);
  topRows.forEach((row) => selectedKeys.add(rowKey(row)));
}

function renderSelectionStatus(selectedKeys) {
  const selectionStatus = document.getElementById("selectionStatus");
  if (selectionStatus) {
    selectionStatus.textContent = `Selected athletes: ${selectedKeys.size}`;
  }
}

function renderSidebarTable(rows, selectedKeys) {
  const tbody = document.getElementById("athleteTableBody");
  if (!tbody) {
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="note">No athletes match current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const key = rowKey(row);
      const checked = selectedKeys.has(key) ? "checked" : "";
      const name = String(row.athlete_name || row.athlete_slug || "Unknown");
      const event = String(row.event || "-");
      const performance = formatPerformance(row.performance_m);
      const videoUrl = String(row.video_url || "").trim();
      const videoCell = videoUrl
        ? `<a href="${videoUrl}" target="_blank" rel="noopener noreferrer">Watch</a>`
        : "-";

      return `
        <tr>
          <td><input type="checkbox" class="athlete-check" data-athlete-key="${key}" ${checked} /></td>
          <td>${name}</td>
          <td>${event}</td>
          <td>${performance}</td>
          <td>${videoCell}</td>
        </tr>
      `;
    })
    .join("");
}

function renderEventChecklist(containerId, events, selectedEventIds, setType, allLabel) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.textContent = "";
  const allChecked = events.length > 0 && selectedEventIds.size === events.length;

  const allWrap = document.createElement("label");
  allWrap.className = "event-filter-item";
  allWrap.innerHTML = `<input type="checkbox" class="event-filter-input" data-event-set="${setType}" data-event-all="true" ${allChecked ? "checked" : ""} /> ${allLabel}`;
  container.appendChild(allWrap);

  events.forEach((eventId) => {
    const item = document.createElement("label");
    item.className = "event-filter-item";
    const checked = selectedEventIds.has(eventId) ? "checked" : "";
    item.innerHTML = `<input type="checkbox" class="event-filter-input" data-event-set="${setType}" data-event-id="${eventId}" ${checked} /> ${eventId}`;
    container.appendChild(item);
  });
}

function setSidebarStatus(message) {
  const sidebarStatus = document.getElementById("sidebarStatus");
  if (sidebarStatus) {
    sidebarStatus.textContent = message;
  }
}

async function loadAthleteRows(categoryEntry) {
  const path = categoryEntry?.athlete_rows_path;
  if (typeof path !== "string" || !path.trim()) {
    return [];
  }

  const payload = await fetchJson(path.trim());
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload;
}

function renderCategorySelect(categories, selectedCategory) {
  const select = document.getElementById("categorySelect");
  if (!select) {
    return;
  }

  select.textContent = "";
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = slugToLabel(category.id);
    select.appendChild(option);
  });
  select.value = selectedCategory;
}

function getCurrentSidebarWidth(layout, sidebar) {
  const cssValue = layout.style.getPropertyValue("--sidebar-width").trim();
  if (cssValue.endsWith("px")) {
    const parsed = Number(cssValue.replace("px", ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return sidebar.getBoundingClientRect().width;
}

function clampSidebarWidth(width) {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
}

function setSidebarWidth(layout, width) {
  layout.style.setProperty("--sidebar-width", `${clampSidebarWidth(width)}px`);
}

function attachSidebarResize(layout, sidebar, handle) {
  let dragState = null;

  handle.addEventListener("mousedown", (event) => {
    if (sidebar.classList.contains("is-collapsed")) {
      return;
    }

    event.preventDefault();
    dragState = {
      startX: event.clientX,
      startWidth: getCurrentSidebarWidth(layout, sidebar),
    };
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragState) {
      return;
    }
    const deltaX = event.clientX - dragState.startX;
    const width = dragState.startWidth + deltaX;
    setSidebarWidth(layout, width);
  });

  window.addEventListener("mouseup", () => {
    dragState = null;
  });
}

function setSidebarCollapsed(layout, sidebar, button, collapsed) {
  layout.classList.toggle("is-sidebar-collapsed", collapsed);
  sidebar.classList.toggle("is-collapsed", collapsed);
  const icon = button.querySelector(".sidebar-toggle-icon");
  const text = button.querySelector(".sidebar-toggle-text");
  if (icon) {
    icon.textContent = collapsed ? ">" : "<";
  }
  if (text) {
    text.textContent = collapsed ? "Unfold" : "Fold";
  } else {
    button.textContent = collapsed ? "Unfold" : "Fold";
  }
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", collapsed ? "Expand athlete controls panel" : "Collapse athlete controls panel");
}

async function main() {
  const overviewStatus = document.getElementById("overviewStatus");
  const speedProfileSections = document.getElementById("speedProfileSections");
  const techniqueStatus = document.getElementById("techniqueStatus");
  const techniqueSections = document.getElementById("techniqueSections");
  const categorySelect = document.getElementById("categorySelect");
  const sortSelect = document.getElementById("sortSelect");
  const top5Button = document.getElementById("top5Button");
  const clearSelectionButton = document.getElementById("clearSelectionButton");
  const athleteSearchInput = document.getElementById("athleteSearchInput");
  const tablePrevPage = document.getElementById("tablePrevPage");
  const tableNextPage = document.getElementById("tableNextPage");
  const tablePageStatus = document.getElementById("tablePageStatus");
  const tablePageSizeSelect = document.getElementById("tablePageSizeSelect");
  const athleteTableBody = document.getElementById("athleteTableBody");
  const topEventChecklist = document.getElementById("topEventChecklist");
  const trainingEventChecklist = document.getElementById("trainingEventChecklist");
  const overviewLayout = document.querySelector(".overview-layout");
  const athleteSidebar = document.querySelector(".athlete-sidebar");
  const sidebarResizeHandle = document.getElementById("sidebarResizeHandle");
  const sidebarToggleButton = document.getElementById("sidebarToggleButton");

  if (
    !overviewStatus ||
    !speedProfileSections ||
    !techniqueStatus ||
    !techniqueSections ||
    !categorySelect ||
    !sortSelect ||
    !top5Button ||
    !clearSelectionButton ||
    !athleteSearchInput ||
    !tablePrevPage ||
    !tableNextPage ||
    !tablePageStatus ||
    !tablePageSizeSelect ||
    !athleteTableBody ||
    !topEventChecklist ||
    !trainingEventChecklist ||
    !overviewLayout ||
    !athleteSidebar ||
    !sidebarResizeHandle ||
    !sidebarToggleButton
  ) {
    return;
  }

  let categories = [];
  let currentCategoryId = "";
  let allAthleteRows = [];
  let sortMode = "performance_desc";
  let availableEvents = [];
  let topEvents = [];
  let trainingEvents = [];
  let eventTypeByEventId = new Map();
  const selectedKeys = new Set();
  const selectedTopEventIds = new Set();
  const selectedTrainingEventIds = new Set();
  let searchQuery = "";
  let currentPage = 1;
  let currentTotalPages = 1;
  let pageSize = DEFAULT_TABLE_PAGE_SIZE;
  let sidebarCollapsed = false;
  let speedProfileOverlayMetadata = null;
  let speedProfileImageElement = null;
  let speedProfileOverlayElement = null;
  let speedProfileResizeObserver = null;
  let speedOverlayRenderScheduled = false;
  let techniqueOverlayRenderScheduled = false;
  let techniqueChartStates = [];
  let techniqueResizeObservers = [];

  function scheduleSpeedOverlayRender() {
    if (speedOverlayRenderScheduled) {
      return;
    }
    speedOverlayRenderScheduled = true;
    requestAnimationFrame(() => {
      speedOverlayRenderScheduled = false;
      renderSpeedProfileOverlay({
        rows: allAthleteRows,
        selectedKeys,
        overlayMetadata: speedProfileOverlayMetadata,
        imageElement: speedProfileImageElement,
        svgElement: speedProfileOverlayElement,
      });
    });
  }

  function scheduleTechniqueOverlayRender() {
    if (techniqueOverlayRenderScheduled) {
      return;
    }
    techniqueOverlayRenderScheduled = true;
    requestAnimationFrame(() => {
      techniqueOverlayRenderScheduled = false;
      techniqueChartStates.forEach((chartState) => {
        renderTechniqueChartOverlay({
          rows: allAthleteRows,
          selectedKeys,
          chartState,
        });
      });
    });
  }

  function disconnectTechniqueResizeObservers() {
    techniqueResizeObservers.forEach((observer) => observer.disconnect());
    techniqueResizeObservers = [];
  }

  async function loadSpeedProfileOverlay(categoryEntry) {
    return loadOverlayMetadata(getSpeedProfileOverlayJsonPath(categoryEntry));
  }

  async function loadTechniqueChartOverlays() {
    await Promise.all(
      techniqueChartStates.map(async (chartState) => {
        chartState.overlayMetadata = await loadOverlayMetadata(chartState.overlayPath);
      })
    );
  }

  function bindTechniqueChartElements(chartEntries) {
    disconnectTechniqueResizeObservers();
    techniqueChartStates = chartEntries.map((chart) => ({
      ...chart,
      imageElement: techniqueSections.querySelector(`[data-technique-chart-image="${chart.id}"]`),
      svgElement: techniqueSections.querySelector(`[data-technique-chart-overlay="${chart.id}"]`),
      summaryElement: techniqueSections.querySelector(`[data-technique-chart-summary="${chart.id}"]`),
      overlayMetadata: null,
    }));

    techniqueChartStates.forEach((chartState) => {
      if (!chartState.imageElement) {
        return;
      }
      chartState.imageElement.addEventListener("load", () => {
        scheduleTechniqueOverlayRender();
      });
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          scheduleTechniqueOverlayRender();
        });
        observer.observe(chartState.imageElement);
        techniqueResizeObservers.push(observer);
      }
    });
  }

  function updateTechniqueVisuals() {
    renderTechniqueEventStrips(allAthleteRows, selectedKeys);
    scheduleTechniqueOverlayRender();
  }

  function scheduleAllOverlayRenders() {
    scheduleSpeedOverlayRender();
    scheduleTechniqueOverlayRender();
  }

  function updateSelectionDrivenVisuals() {
    renderSelectionStatus(selectedKeys);
    renderSpeedProfileSplitTable(allAthleteRows, selectedKeys);
    updateTechniqueVisuals();
    scheduleSpeedOverlayRender();
  }

  function setTechniqueStatusMessage(message) {
    if (techniqueStatus) {
      techniqueStatus.textContent = message;
    }
  }

  function renderSidebar() {
    availableEvents = uniqueEvents(allAthleteRows);
    ({ topEvents, trainingEvents } = splitEventsByType(availableEvents, eventTypeByEventId));

    [...selectedTopEventIds].forEach((eventId) => {
      if (!topEvents.includes(eventId)) {
        selectedTopEventIds.delete(eventId);
      }
    });
    [...selectedTrainingEventIds].forEach((eventId) => {
      if (!trainingEvents.includes(eventId)) {
        selectedTrainingEventIds.delete(eventId);
      }
    });

    renderEventChecklist("topEventChecklist", topEvents, selectedTopEventIds, "top", "All top events");
    renderEventChecklist(
      "trainingEventChecklist",
      trainingEvents,
      selectedTrainingEventIds,
      "training",
      "All training events"
    );
    const eventFilteredRows = applyFiltersAndSort(allAthleteRows, selectedTopEventIds, selectedTrainingEventIds, sortMode);
    const visibleRows = filterRowsByName(eventFilteredRows, searchQuery);
    const pagination = paginateRows(visibleRows, currentPage, pageSize);
    currentPage = pagination.currentPage;
    currentTotalPages = pagination.totalPages;
    renderSidebarTable(pagination.pageRows, selectedKeys);
    renderSelectionStatus(selectedKeys);
    renderSpeedProfileSplitTable(allAthleteRows, selectedKeys);
    updateTechniqueVisuals();

    tablePrevPage.disabled = currentPage <= 1;
    tableNextPage.disabled = currentPage >= currentTotalPages;
    tablePageStatus.textContent = `Page ${currentPage} / ${currentTotalPages}`;

    const mergedEventIds = new Set([...selectedTopEventIds, ...selectedTrainingEventIds]);
    const eventScope = !availableEvents.length
      ? "no events"
      : mergedEventIds.size === availableEvents.length
        ? "all events"
        : `${mergedEventIds.size} merged event(s)`;
    const rangeText = pagination.totalRows
      ? `rows ${pagination.startIndex + 1}-${pagination.endIndex} of ${pagination.totalRows}`
      : "rows 0 of 0";
    setSidebarStatus(
      `Showing ${rangeText}, ${eventScope}. Top: ${selectedTopEventIds.size}/${topEvents.length}, Training: ${selectedTrainingEventIds.size}/${trainingEvents.length}.`
    );
    scheduleAllOverlayRenders();
  }

  async function loadCategory(categoryId) {
    currentCategoryId = categoryId;
    updateCategoryQuery(currentCategoryId);

    const categoryEntry = categories.find((entry) => entry.id === currentCategoryId);
    if (!categoryEntry) {
      if (speedProfileResizeObserver) {
        speedProfileResizeObserver.disconnect();
        speedProfileResizeObserver = null;
      }
      disconnectTechniqueResizeObservers();
      techniqueChartStates = [];
      speedProfileSections.innerHTML = '<p class="note">Selected category is unavailable.</p>';
      techniqueSections.innerHTML = '<p class="note">Technique view unavailable for this category.</p>';
      allAthleteRows = [];
      selectedTopEventIds.clear();
      selectedTrainingEventIds.clear();
      setTechniqueStatusMessage("Technique charts unavailable.");
      renderSidebar();
      return;
    }

    renderSpeedProfileCard(speedProfileSections, categoryEntry);
    const techniqueChartEntries = renderTechniqueSection(techniqueSections, categoryEntry);
    bindTechniqueChartElements(techniqueChartEntries);

    speedProfileImageElement = document.getElementById("speedProfileImage");
    speedProfileOverlayElement = document.getElementById("speedProfileOverlay");
    if (speedProfileResizeObserver) {
      speedProfileResizeObserver.disconnect();
      speedProfileResizeObserver = null;
    }
    if (speedProfileImageElement) {
      speedProfileImageElement.addEventListener("load", () => {
        scheduleSpeedOverlayRender();
      });
      if (typeof ResizeObserver !== "undefined") {
        speedProfileResizeObserver = new ResizeObserver(() => {
          scheduleSpeedOverlayRender();
        });
        speedProfileResizeObserver.observe(speedProfileImageElement);
      }
    }
    speedProfileOverlayMetadata = await loadSpeedProfileOverlay(categoryEntry);
    await loadTechniqueChartOverlays();
    allAthleteRows = await loadAthleteRows(categoryEntry);
    sortMode = "performance_desc";
    sortSelect.value = sortMode;
    availableEvents = uniqueEvents(allAthleteRows);
    ({ topEvents, trainingEvents } = splitEventsByType(availableEvents, eventTypeByEventId));

    selectedTopEventIds.clear();
    selectedTrainingEventIds.clear();
    topEvents.forEach((eventId) => selectedTopEventIds.add(eventId));
    trainingEvents.forEach((eventId) => selectedTrainingEventIds.add(eventId));

    applyTop5Preset(allAthleteRows, selectedKeys);
    searchQuery = "";
    athleteSearchInput.value = "";
    currentPage = 1;
    renderSidebar();

    overviewStatus.textContent = `Showing speed profile and controls for ${slugToLabel(currentCategoryId)}.`;
    setTechniqueStatusMessage("");
  }

  try {
    overviewStatus.textContent = "Loading analysis charts...";
    const manifest = await loadManifest();
    eventTypeByEventId = buildEventTypeByEventId(manifest);
    categories = manifest?.analysis?.DNF?.categories || [];

    if (!Array.isArray(categories) || !categories.length) {
      overviewStatus.textContent = "No DNF analysis categories found in manifest.";
      speedProfileSections.innerHTML = '<p class="note">Run data curation to publish analysis charts into public/data.</p>';
      techniqueSections.innerHTML = '<p class="note">No technique charts available in manifest.</p>';
      setTechniqueStatusMessage("Technique charts unavailable.");
      allAthleteRows = [];
      selectedTopEventIds.clear();
      selectedTrainingEventIds.clear();
      renderSidebar();
      return;
    }

    const requestedCategory = getRequestedCategory();
    const categoryIds = categories.map((entry) => entry.id);
    currentCategoryId = categoryIds.includes(requestedCategory) ? requestedCategory : categoryIds[0];
    renderCategorySelect(categories, currentCategoryId);

    attachSidebarResize(overviewLayout, athleteSidebar, sidebarResizeHandle);
    setSidebarCollapsed(overviewLayout, athleteSidebar, sidebarToggleButton, sidebarCollapsed);
    window.addEventListener("resize", scheduleAllOverlayRenders);

    categorySelect.addEventListener("change", async () => {
      await loadCategory(categorySelect.value);
    });

    sortSelect.addEventListener("change", () => {
      sortMode = sortSelect.value;
      currentPage = 1;
      renderSidebar();
    });

    top5Button.addEventListener("click", () => {
      applyTop5Preset(allAthleteRows, selectedKeys);
      currentPage = 1;
      renderSidebar();
    });

    clearSelectionButton.addEventListener("click", () => {
      selectedKeys.clear();
      renderSidebar();
    });

    athleteSearchInput.addEventListener("input", () => {
      searchQuery = athleteSearchInput.value.trim();
      currentPage = 1;
      renderSidebar();
    });

    tablePrevPage.addEventListener("click", () => {
      if (currentPage <= 1) {
        return;
      }
      currentPage -= 1;
      renderSidebar();
    });

    tableNextPage.addEventListener("click", () => {
      if (currentPage >= currentTotalPages) {
        return;
      }
      currentPage += 1;
      renderSidebar();
    });

    tablePageSizeSelect.addEventListener("change", () => {
      const parsed = Number(tablePageSizeSelect.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        pageSize = Math.floor(parsed);
      }
      currentPage = 1;
      renderSidebar();
    });

    sidebarToggleButton.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      setSidebarCollapsed(overviewLayout, athleteSidebar, sidebarToggleButton, sidebarCollapsed);
    });

    const handleEventChecklistChange = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.classList.contains("event-filter-input")) {
        return;
      }

      const setType = target.dataset.eventSet;
      const targetSet = setType === "training" ? selectedTrainingEventIds : selectedTopEventIds;

      if (target.dataset.eventAll === "true") {
        targetSet.clear();
        if (target.checked) {
          const source = setType === "training" ? trainingEvents : topEvents;
          source.forEach((eventId) => targetSet.add(eventId));
        }
      } else {
        const eventId = target.dataset.eventId || "";
        if (!eventId) {
          return;
        }
        if (target.checked) {
          targetSet.add(eventId);
        } else {
          targetSet.delete(eventId);
        }
      }

      currentPage = 1;
      renderSidebar();
    };
    topEventChecklist.addEventListener("change", handleEventChecklistChange);
    trainingEventChecklist.addEventListener("change", handleEventChecklistChange);

    athleteTableBody.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.classList.contains("athlete-check")) {
        return;
      }
      const key = target.dataset.athleteKey || "";
      if (!key) {
        return;
      }
      if (target.checked) {
        selectedKeys.add(key);
      } else {
        selectedKeys.delete(key);
      }
      updateSelectionDrivenVisuals();
    });

    await loadCategory(currentCategoryId);
  } catch (error) {
    overviewStatus.textContent = `Failed to load DNF Overview: ${error.message}`;
    setTechniqueStatusMessage("Failed to load technique section.");
    setSidebarStatus("Failed to load athlete controls.");
  }
}

main();
