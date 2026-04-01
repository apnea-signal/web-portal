import { formatNumber, loadSummaryBundle, slugToDisplay, toNumber } from "./data.js";
import { initDnfShell } from "./dnf-shell.js";

const bundleCache = new Map();

function cacheKey(eventId, category) {
  return `${eventId}::${category}`;
}

async function getBundle(manifest, eventId, category) {
  const key = cacheKey(eventId, category);
  if (bundleCache.has(key)) {
    return bundleCache.get(key);
  }
  const bundle = await loadSummaryBundle(manifest, eventId, category);
  bundleCache.set(key, bundle);
  return bundle;
}

function getQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    athlete: params.get("athlete") || "",
    peers: params.getAll("peer"),
  };
}

function syncAthleteQuery(athlete, peers) {
  const params = new URLSearchParams(window.location.search);
  if (athlete) {
    params.set("athlete", athlete);
  } else {
    params.delete("athlete");
  }
  params.delete("peer");
  peers.forEach((peer) => params.append("peer", peer));
  history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function median(values) {
  if (!values.length) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function findAthleteEntry(manifest, slug, preferredEvent, preferredCategory) {
  const athlete = (manifest.athletes || []).find((row) => row.slug === slug);
  if (!athlete) {
    return null;
  }

  const preferred = (athlete.entries || []).find(
    (entry) => (entry.event || entry.stream) === preferredEvent && entry.category === preferredCategory
  );
  if (preferred) {
    return preferred;
  }
  return athlete.entries?.[0] || null;
}

function findAthleteRecord(summaryPayload, athleteSlug) {
  return (summaryPayload?.athletes || []).find((row) => row.athlete === athleteSlug) || null;
}

function allAthletes(manifest) {
  return (manifest.athletes || []).slice().sort((a, b) => a.display_name.localeCompare(b.display_name));
}

function setStatus(message) {
  const status = document.getElementById("athleteStatus");
  if (status) {
    status.textContent = message;
  }
}

function renderSearchResults(manifest, searchTerm, onSelect) {
  const container = document.getElementById("searchResults");
  if (!container) {
    return;
  }
  container.textContent = "";

  const query = searchTerm.trim().toLowerCase();
  const results = allAthletes(manifest).filter((athlete) => {
    if (!query) {
      return true;
    }
    return (
      athlete.slug.toLowerCase().includes(query) ||
      athlete.display_name.toLowerCase().includes(query)
    );
  });

  if (!results.length) {
    container.innerHTML = '<p class="note">No matching athletes in curated data.</p>';
    return;
  }

  results.slice(0, 80).forEach((athlete) => {
    (athlete.entries || []).forEach((entry) => {
      const eventId = entry.event || entry.stream;
      const button = document.createElement("button");
      button.className = "list-item";
      button.type = "button";
      button.innerHTML = `
        <span class="title">${athlete.display_name}</span>
        <span class="meta">${eventId} / ${entry.category}</span>
      `;
      button.addEventListener("click", () => onSelect(athlete.slug, entry));
      container.appendChild(button);
    });
  });
}

function renderPeerChecklist(manifest, selectedPeers, onToggle) {
  const container = document.getElementById("peerChecklist");
  if (!container) {
    return;
  }
  container.textContent = "";

  allAthletes(manifest).forEach((athlete) => {
    const wrap = document.createElement("label");
    wrap.className = "peer-chip";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedPeers.has(athlete.slug);
    checkbox.addEventListener("change", () => onToggle(athlete.slug, checkbox.checked));

    const text = document.createElement("span");
    text.textContent = athlete.display_name;

    wrap.appendChild(checkbox);
    wrap.appendChild(text);
    container.appendChild(wrap);
  });
}

function renderComparisonTable(rows) {
  const container = document.getElementById("comparisonTable");
  if (!container) {
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Athlete</th>
          <th>Context</th>
          <th>Distance (m)</th>
          <th>Time (s)</th>
          <th>Avg Speed (m/s)</th>
          <th>Total Impulse</th>
          <th>Cycle Speed (m/s)</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${row.name}</td>
            <td>${row.context}</td>
            <td>${formatNumber(row.distance, 2)}</td>
            <td>${formatNumber(row.time, 2)}</td>
            <td>${formatNumber(row.speed, 3)}</td>
            <td>${formatNumber(row.impulse, 2)}</td>
            <td>${formatNumber(row.cycleSpeed, 3)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function computeReferenceRows(currentSummary, peerRows) {
  const athletes = currentSummary?.athletes || [];
  const cohortDistance = median(athletes.map((row) => toNumber(row.distance_m)).filter(Number.isFinite));
  const cohortSpeed = median(athletes.map((row) => toNumber(row.avg_speed_mps)).filter(Number.isFinite));
  const cohortTime = median(athletes.map((row) => toNumber(row.time_s)).filter(Number.isFinite));

  const peerDistance = median(peerRows.map((row) => toNumber(row.distance)).filter(Number.isFinite));
  const peerSpeed = median(peerRows.map((row) => toNumber(row.speed)).filter(Number.isFinite));
  const peerTime = median(peerRows.map((row) => toNumber(row.time)).filter(Number.isFinite));

  return [
    {
      name: "Current Cohort Median",
      context: "Selected event/category",
      distance: cohortDistance,
      time: cohortTime,
      speed: cohortSpeed,
      impulse: Number.NaN,
      cycleSpeed: Number.NaN,
    },
    {
      name: "Selected Peers Median",
      context: "Across chosen peers",
      distance: peerDistance,
      time: peerTime,
      speed: peerSpeed,
      impulse: Number.NaN,
      cycleSpeed: Number.NaN,
    },
  ];
}

async function buildAthleteRow(manifest, slug, preferredEvent, preferredCategory, labelPrefix = "") {
  const entry = findAthleteEntry(manifest, slug, preferredEvent, preferredCategory);
  if (!entry) {
    return null;
  }

  const eventId = entry.event || entry.stream;
  const bundle = await getBundle(manifest, eventId, entry.category);
  const total = findAthleteRecord(bundle.total, slug);
  const overview = findAthleteRecord(bundle.overview, slug);

  if (!total && !overview) {
    return null;
  }

  return {
    slug,
    name: slugToDisplay(slug),
    context: `${labelPrefix}${eventId} / ${entry.category}`,
    distance: toNumber(total?.distance_m),
    time: toNumber(total?.time_s),
    speed: toNumber(total?.avg_speed_mps),
    impulse: toNumber(total?.total_impulse),
    cycleSpeed: toNumber(overview?.cycle_avg_speed_mps),
  };
}

async function renderPageState({ manifest, eventId, category, selectedAthlete, selectedPeers }) {
  const primaryRow = selectedAthlete
    ? await buildAthleteRow(manifest, selectedAthlete, eventId, category, "Primary · ")
    : null;

  if (!primaryRow) {
    renderComparisonTable([]);
    setStatus("Select an athlete entry to build the comparison view.");
    return;
  }

  const peerRows = [];
  for (const peerSlug of selectedPeers) {
    if (peerSlug === selectedAthlete) {
      continue;
    }
    const peer = await buildAthleteRow(manifest, peerSlug, eventId, category, "Peer · ");
    if (peer) {
      peerRows.push(peer);
    }
  }

  const currentBundle = await getBundle(manifest, eventId, category);
  const referenceRows = computeReferenceRows(currentBundle.total, peerRows);

  renderComparisonTable([primaryRow, ...peerRows, ...referenceRows]);
  setStatus(`Comparing ${primaryRow.name} with ${peerRows.length} selected peer(s).`);
}

async function main() {
  const shell = await initDnfShell({ activePage: "athletes" });
  const manifest = shell.manifest;
  const queryState = getQueryState();

  const searchInput = document.getElementById("athleteSearchInput");
  const chosenLabel = document.getElementById("selectedAthleteLabel");

  let selectedAthlete = queryState.athlete || "";
  const selectedPeers = new Set(queryState.peers || []);

  const refresh = async () => {
    const context = shell.getContext();
    if (!context) {
      return;
    }

    if (chosenLabel) {
      chosenLabel.textContent = selectedAthlete ? slugToDisplay(selectedAthlete) : "No athlete selected";
    }

    syncAthleteQuery(selectedAthlete, [...selectedPeers]);
    await renderPageState({
      manifest,
      eventId: context.event,
      category: context.category,
      selectedAthlete,
      selectedPeers,
    });
  };

  renderSearchResults(manifest, "", (slug, entry) => {
    selectedAthlete = slug;
    const eventId = entry.event || entry.stream;

    const eventSelect = document.getElementById("eventSelect") || document.getElementById("streamSelect");
    const categorySelect = document.getElementById("categorySelect");
    if (eventSelect && categorySelect) {
      eventSelect.value = eventId;
      eventSelect.dispatchEvent(new Event("change"));
      categorySelect.value = entry.category;
      categorySelect.dispatchEvent(new Event("change"));
    }

    refresh();
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderSearchResults(manifest, searchInput.value, (slug, entry) => {
        selectedAthlete = slug;
        const eventId = entry.event || entry.stream;
        const eventSelect = document.getElementById("eventSelect") || document.getElementById("streamSelect");
        const categorySelect = document.getElementById("categorySelect");
        if (eventSelect && categorySelect) {
          eventSelect.value = eventId;
          eventSelect.dispatchEvent(new Event("change"));
          categorySelect.value = entry.category;
          categorySelect.dispatchEvent(new Event("change"));
        }
        refresh();
      });
    });
  }

  renderPeerChecklist(manifest, selectedPeers, (slug, checked) => {
    if (checked) {
      selectedPeers.add(slug);
    } else {
      selectedPeers.delete(slug);
    }
    refresh();
  });

  shell.onChange(() => {
    refresh();
  });

  await refresh();
}

main().catch((error) => {
  setStatus(`Failed to initialize athlete explorer: ${error.message}`);
});
