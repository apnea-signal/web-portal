import { findCategoryRow, getCategoryRows, getEventIds, loadManifest } from "./data.js";

function getQuerySelection() {
  const params = new URLSearchParams(window.location.search);
  return {
    event: params.get("event") || params.get("stream") || "",
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

function getDnfCategoryRows(manifest, eventId) {
  return getCategoryRows(manifest, eventId).filter((row) => supportsDnf(row));
}

function updateQuery(eventId, category) {
  const params = new URLSearchParams(window.location.search);
  params.set("event", eventId);
  params.delete("stream");
  params.set("category", category);
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  history.replaceState({}, "", nextUrl);
}

function updateNavLinks(eventId, category) {
  const tabs = document.querySelectorAll(".nav-tab[data-page]");
  tabs.forEach((tab) => {
    const page = tab.getAttribute("data-page");
    if (!page) {
      return;
    }
    if (page === "overview") {
      tab.setAttribute("href", "../overview/");
      return;
    }
    const params = new URLSearchParams({ event: eventId, category });
    tab.setAttribute("href", `../${page}/?${params.toString()}`);
  });
}

export async function initDnfShell({ activePage }) {
  const manifest = await loadManifest();
  const eventSelect = document.getElementById("eventSelect") || document.getElementById("streamSelect");
  const categorySelect = document.getElementById("categorySelect");
  const scopeLabel = document.getElementById("scopeLabel");

  if (!eventSelect || !categorySelect || !scopeLabel) {
    throw new Error("Missing required shell controls in page");
  }

  const eventIds = getEventIds(manifest).filter((eventId) => getDnfCategoryRows(manifest, eventId).length > 0);
  if (!eventIds.length) {
    throw new Error("No DNF-capable events found in manifest");
  }

  eventSelect.textContent = "";
  eventIds.forEach((eventId) => {
    const option = document.createElement("option");
    option.value = eventId;
    option.textContent = eventId;
    eventSelect.appendChild(option);
  });

  const requested = getQuerySelection();
  let currentEvent = eventIds.includes(requested.event) ? requested.event : eventIds[0];

  function repopulateCategories() {
    const categories = getDnfCategoryRows(manifest, currentEvent);
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

  eventSelect.value = currentEvent;
  repopulateCategories();

  const listeners = [];
  let lastContext = null;

  function emitChange() {
    const eventId = eventSelect.value;
    const category = categorySelect.value;
    updateQuery(eventId, category);
    updateNavLinks(eventId, category);

    const row = findCategoryRow(manifest, eventId, category);
    const checkpointCount = Object.keys(row?.summary_files || {}).length;
    scopeLabel.textContent = `${eventId} / ${category} · ${checkpointCount} checkpoint views`;

    lastContext = { manifest, event: eventId, category, categoryRow: row };

    listeners.forEach((listener) => {
      listener(lastContext);
    });
  }

  eventSelect.addEventListener("change", () => {
    currentEvent = eventSelect.value;
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
      return { event: eventSelect.value, category: categorySelect.value };
    },
    getContext() {
      return lastContext;
    },
    manifest,
  };
}
