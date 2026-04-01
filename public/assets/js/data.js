const manifestCache = {
  payload: null,
};

export function getPortalBase() {
  const baseMeta = document.querySelector('meta[name="portal-base"]');
  return baseMeta?.content || "./";
}

export function toPortalUrl(path) {
  return new URL(path, new URL(getPortalBase(), window.location.href)).toString();
}

export async function fetchJson(path) {
  const response = await fetch(toPortalUrl(path));
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.json();
}

export async function loadManifest() {
  if (manifestCache.payload) {
    return manifestCache.payload;
  }
  const payload = await fetchJson("data/manifest.json");
  if (!payload.events && Array.isArray(payload.streams)) {
    payload.events = payload.streams;
  }
  manifestCache.payload = payload;
  return manifestCache.payload;
}

function eventRows(manifest) {
  return manifest.events || manifest.streams || [];
}

export function getEventIds(manifest) {
  return eventRows(manifest).map((event) => event.id);
}

export function getCategoryRows(manifest, eventId) {
  const event = eventRows(manifest).find((row) => row.id === eventId);
  return event?.categories || [];
}

export function findCategoryRow(manifest, eventId, categoryId) {
  return getCategoryRows(manifest, eventId).find((row) => row.id === categoryId) || null;
}

export async function loadSummaryBundle(manifest, eventId, categoryId) {
  const category = findCategoryRow(manifest, eventId, categoryId);
  if (!category) {
    throw new Error(`Missing category ${eventId}/${categoryId}`);
  }

  const summaryFiles = category.summary_files || {};
  const keys = Object.keys(summaryFiles);

  const entries = await Promise.all(
    keys.map(async (checkpoint) => {
      const payload = await fetchJson(summaryFiles[checkpoint]);
      return [checkpoint, payload];
    })
  );

  const bundle = {};
  for (const [checkpoint, payload] of entries) {
    bundle[checkpoint] = payload;
  }
  return bundle;
}

export function slugToDisplay(slug) {
  return String(slug || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

export function formatNumber(value, digits = 2) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toFixed(digits);
}

export function rankAthletes(rows, key, direction = "desc") {
  const values = rows
    .map((row) => ({ row, value: toNumber(row[key]) }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value));

  const rankMap = new Map();
  values.forEach((entry, index) => {
    rankMap.set(entry.row.athlete, index + 1);
  });
  return rankMap;
}
