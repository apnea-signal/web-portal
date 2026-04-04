import { fetchJson, loadManifest } from "./data.js";

const SPEED_BAND_MPS = {
  min: 0.81,
  max: 0.94,
};

const SIDEBAR_MIN_WIDTH = 380;
const SIDEBAR_MAX_WIDTH = 860;
const DEFAULT_TABLE_PAGE_SIZE = 10;

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

function timeForDistanceAtSpeed(distanceMeters, speedMps) {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(speedMps) || speedMps <= 0) {
    return Number.NaN;
  }
  return distanceMeters / speedMps;
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

function rowKey(row) {
  return `${row.event}::${row.athlete_slug}`;
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
         <img src="${chartPath}" alt="Speed profile top athletes for ${slugToLabel(categoryId)}" loading="lazy" />
         <figcaption class="figure-caption">Category: ${slugToLabel(categoryId)}</figcaption>
       </figure>`
    : `<div class="speed-profile-missing">
         <p class="note">Chart not available yet for ${slugToLabel(categoryId)}.</p>
       </div>`;

  container.innerHTML = `
    <article class="speed-profile-card">
      <div class="speed-profile-visual">${chartMarkup}</div>
      <div class="speed-profile-notes">
        <h3>Training Notes</h3>
        <p class="note">Top athletes speeds range between <strong>${SPEED_BAND_MPS.min.toFixed(2)} and ${SPEED_BAND_MPS.max.toFixed(2)} m/s</strong>.</p>
        <div class="table-wrap speed-reference-wrap">
          <table>
            <thead>
              <tr>
                <th>Speed</th>
                <th>Time to 25m</th>
                <th>Time to 50m</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${SPEED_BAND_MPS.min.toFixed(2)} m/s</td>
                <td>${formatDuration(timeForDistanceAtSpeed(25, SPEED_BAND_MPS.min))}</td>
                <td>${formatDuration(timeForDistanceAtSpeed(50, SPEED_BAND_MPS.min))}</td>
              </tr>
              <tr>
                <td>${SPEED_BAND_MPS.max.toFixed(2)} m/s</td>
                <td>${formatDuration(timeForDistanceAtSpeed(25, SPEED_BAND_MPS.max))}</td>
                <td>${formatDuration(timeForDistanceAtSpeed(50, SPEED_BAND_MPS.max))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </article>
  `;
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
  }

  async function loadCategory(categoryId) {
    currentCategoryId = categoryId;
    updateCategoryQuery(currentCategoryId);

    const categoryEntry = categories.find((entry) => entry.id === currentCategoryId);
    if (!categoryEntry) {
      speedProfileSections.innerHTML = '<p class="note">Selected category is unavailable.</p>';
      allAthleteRows = [];
      selectedTopEventIds.clear();
      selectedTrainingEventIds.clear();
      renderSidebar();
      return;
    }

    renderSpeedProfileCard(speedProfileSections, categoryEntry);
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
  }

  try {
    overviewStatus.textContent = "Loading analysis charts...";
    const manifest = await loadManifest();
    eventTypeByEventId = buildEventTypeByEventId(manifest);
    categories = manifest?.analysis?.DNF?.categories || [];

    if (!Array.isArray(categories) || !categories.length) {
      overviewStatus.textContent = "No DNF analysis categories found in manifest.";
      speedProfileSections.innerHTML = '<p class="note">Run data curation to publish analysis charts into public/data.</p>';
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
      renderSelectionStatus(selectedKeys);
    });

    await loadCategory(currentCategoryId);
  } catch (error) {
    overviewStatus.textContent = `Failed to load DNF Overview: ${error.message}`;
    setSidebarStatus("Failed to load athlete controls.");
  }
}

main();
