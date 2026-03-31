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
  manifestCache.payload = await fetchJson("data/manifest.json");
  return manifestCache.payload;
}

export function getStreamIds(manifest) {
  return (manifest.streams || []).map((stream) => stream.id);
}

export function getCategoryRows(manifest, streamId) {
  const stream = (manifest.streams || []).find((row) => row.id === streamId);
  return stream?.categories || [];
}

export function findCategoryRow(manifest, streamId, categoryId) {
  return getCategoryRows(manifest, streamId).find((row) => row.id === categoryId) || null;
}

export async function loadSummaryBundle(manifest, streamId, categoryId) {
  const category = findCategoryRow(manifest, streamId, categoryId);
  if (!category) {
    throw new Error(`Missing category ${streamId}/${categoryId}`);
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
