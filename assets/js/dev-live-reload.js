(function () {
  const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1";

  if (!isLocalHost) {
    return;
  }

  const baseMeta = document.querySelector('meta[name="portal-base"]');
  const base = baseMeta?.content || "./";
  const endpoint = new URL("__reload__", new URL(base, window.location.href)).toString();

  let lastVersion = null;

  async function poll() {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const version = Number(payload.version);
      if (!Number.isFinite(version)) {
        return;
      }

      if (lastVersion === null) {
        lastVersion = version;
        return;
      }

      if (version !== lastVersion) {
        window.location.reload();
      }
    } catch (_error) {
      // No-op on polling errors.
    }
  }

  poll();
  window.setInterval(poll, 1000);
})();
