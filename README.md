# web-portal

Static web portal for apnea-signal analysis artifacts.

## Local dev (auto-refresh)

### 1) Sync source artifacts into local cache (when needed)
```bash
python3 01_sync_from_s3.py
```

### 2) Curate tracked web snapshot (when cache changes)
Copies selected event/category artifacts from `cache/` into `public/data/` and builds `public/data/manifest.json`.

```bash
python3 scripts/curate_public_data.py --clear
```

### 3) Start dev server (no build step)
```bash
python3 scripts/dev_server.py --port 8000
```

Open:
- `http://localhost:8000/` (discipline fork)
- `http://localhost:8000/dnf/overview/`
- `http://localhost:8000/dnf/athletes/`

Files under `public/` auto-refresh automatically in the browser.

### Production-style build (used by CI)
```bash
python3 scripts/build_site.py
python3 -m http.server 8000 --directory site
```

## Structure

- `public/`: static site source
- `public/data/`: curated, versioned data snapshot used in previews
- `site/`: generated output for deployment
- `scripts/curate_public_data.py`: data curation + manifest generator
- `scripts/dev_server.py`: local dev server with live reload endpoint
- `scripts/build_site.py`: static build step

## Docs

- consumer contract (canonical): `docs/data-contract.md`
- source integration strategy: `docs/data-sources-strategy.md`
- product/business context: `docs/business-context.md`

## GitHub Pages workflows

- `.github/workflows/deploy-main.yml`: deploys `main` to `gh-pages` root
- `.github/workflows/pr-previews.yml`: deploys per-PR previews under `gh-pages/pr-preview/`

These workflows are static-only (no MkDocs).
