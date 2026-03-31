import { findCategoryRow, getCategoryRows, getStreamIds, loadManifest } from "./data.js";

function getQuerySelection() {
  const params = new URLSearchParams(window.location.search);
  return {
    stream: params.get("stream") || "",
    category: params.get("category") || "",
  };
}

function supportsDnf(categoryRow) {
  const disciplines = categoryRow?.disciplines || [];
  if (!disciplines.length) {
    return true;
  }
  return disciplines.includes("DNF");
}

function getDnfCategoryRows(manifest, streamId) {
  return getCategoryRows(manifest, streamId).filter((row) => supportsDnf(row));
}

function updateQuery(stream, category) {
  const params = new URLSearchParams(window.location.search);
  params.set("stream", stream);
  params.set("category", category);
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  history.replaceState({}, "", nextUrl);
}

function updateNavLinks(stream, category) {
  const tabs = document.querySelectorAll(".nav-tab[data-page]");
  tabs.forEach((tab) => {
    const page = tab.getAttribute("data-page");
    if (!page) {
      return;
    }
    const params = new URLSearchParams({ stream, category });
    tab.setAttribute("href", `../${page}/?${params.toString()}`);
  });
}

export async function initDnfShell({ activePage }) {
  const manifest = await loadManifest();
  const streamSelect = document.getElementById("streamSelect");
  const categorySelect = document.getElementById("categorySelect");
  const scopeLabel = document.getElementById("scopeLabel");

  if (!streamSelect || !categorySelect || !scopeLabel) {
    throw new Error("Missing required shell controls in page");
  }

  const streamIds = getStreamIds(manifest).filter((streamId) => getDnfCategoryRows(manifest, streamId).length > 0);
  if (!streamIds.length) {
    throw new Error("No DNF-capable streams found in manifest");
  }

  streamSelect.textContent = "";
  streamIds.forEach((streamId) => {
    const option = document.createElement("option");
    option.value = streamId;
    option.textContent = streamId;
    streamSelect.appendChild(option);
  });

  const requested = getQuerySelection();
  let currentStream = streamIds.includes(requested.stream) ? requested.stream : streamIds[0];

  function repopulateCategories() {
    const categories = getDnfCategoryRows(manifest, currentStream);
    categorySelect.textContent = "";
    categories.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.id;
      categorySelect.appendChild(option);
    });

    const validIds = categories.map((row) => row.id);
    const requestedCategory = requested.category;
    const preferred = validIds.includes(requestedCategory) ? requestedCategory : validIds[0];
    categorySelect.value = preferred;
  }

  streamSelect.value = currentStream;
  repopulateCategories();

  const listeners = [];
  let lastContext = null;

  function emitChange() {
    const stream = streamSelect.value;
    const category = categorySelect.value;
    updateQuery(stream, category);
    updateNavLinks(stream, category);

    const row = findCategoryRow(manifest, stream, category);
    const checkpointCount = Object.keys(row?.summary_files || {}).length;
    scopeLabel.textContent = `${stream} / ${category} · ${checkpointCount} checkpoint views`;

    lastContext = { manifest, stream, category, categoryRow: row };

    listeners.forEach((listener) => {
      listener(lastContext);
    });
  }

  streamSelect.addEventListener("change", () => {
    currentStream = streamSelect.value;
    repopulateCategories();
    emitChange();
  });

  categorySelect.addEventListener("change", emitChange);

  const navTabs = document.querySelectorAll(".nav-tab[data-page]");
  navTabs.forEach((tab) => {
    const page = tab.getAttribute("data-page");
    if (page === activePage) {
      tab.classList.add("is-active");
      tab.setAttribute("aria-current", "page");
    }
  });

  emitChange();

  return {
    onChange(callback) {
      listeners.push(callback);
    },
    getSelection() {
      return { stream: streamSelect.value, category: categorySelect.value };
    },
    getContext() {
      return lastContext;
    },
    manifest,
  };
}
