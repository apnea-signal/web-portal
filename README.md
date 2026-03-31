# web-portal

Static web portal for apnea-signal analysis artifacts.

## Local workflow

### 1) Sync source artifacts into local cache
```bash
python 01_sync_from_s3.py
```

### 2) Curate tracked web snapshot
Copies selected stream/category artifacts from `cache/` into `public/data/` and builds `public/data/manifest.json`.

```bash
python scripts/curate_public_data.py --clear
```

### 3) Run static site locally
```bash
python scripts/build_site.py
python -m http.server 8000 --directory site
# open http://localhost:8000
```

### Check the pages yourself
From the repo root:

```bash
python3 scripts/curate_public_data.py --clear
python3 scripts/build_site.py
python3 -m http.server 8000 --directory site
```

Open:
- `http://localhost:8000/` (discipline fork)
- `http://localhost:8000/dnf/overview/`
- `http://localhost:8000/dnf/athletes/`

If you change files under `public/`, rerun:

```bash
python3 scripts/build_site.py
```

## Structure

- `public/`: static site source
- `public/data/`: curated, versioned data snapshot used in previews
- `site/`: generated output for deployment
- `scripts/curate_public_data.py`: data curation + manifest generator
- `scripts/build_site.py`: static build step

## GitHub Pages workflows

- `.github/workflows/deploy-main.yml`: deploys `main` to `gh-pages` root
- `.github/workflows/pr-previews.yml`: deploys per-PR previews under `gh-pages/pr-preview/`

These workflows are static-only (no MkDocs).
