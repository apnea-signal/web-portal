# Data Contract (Consumer-Driven)

## Purpose
This document is the portal's canonical consumer contract.

It defines:
- what data the UI expects,
- which fields are required vs optional,
- what is currently available,
- what fallback/placeholder behavior applies when inputs are missing.

## Contract Changelog
| Date | Version | Summary | Notes |
| --- | --- | --- | --- |
| 2026-03-31 | v0.2.0 | Added Overview question-to-data mapping for cross-event discipline-wide answers and explicit placeholder behavior for missing producer outputs. | Captures KPI, milestone, and technique relationship inputs used by Overview. |
| 2026-03-31 | v0.1.0 | Initial canonical contract extracted into dedicated document. | Defines `events` as primary keyset, keeps `streams` compatibility keys, and introduces `cross_event_distributions` placeholder contract for Overview. |

Update rule:
- add one row per contract-affecting change (shape, requiredness, or fallback behavior),
- keep newest entries at the top.

## Contract Ownership and Precedence
- Portal is a downstream consumer of apnea-signal pipeline artifacts.
- Solver outputs are authoritative for displayed performance metrics.
- Annotation outputs are contextual metadata/provenance only.

Operational context (ADR-0001):
- local cache remains the default source during development,
- curated snapshot under `public/data/` is the tracked input for static preview/deploy.

## Core Domain Keys
- `discipline`: `DNF` (active), `DYNB`, `DYN` (planned)
- `event`: top-level event identifier (formerly `stream`)
- `category`: cohort grouping within event (e.g. `seniors-male`)
- `athlete`: slug identifier for person-level joins

## Portal-Facing Manifest Contract
Manifest file: `public/data/manifest.json`

Required:
- `generated_at: string`
- `events: Event[]`
- `athletes: AthleteIndex[]`

`Event`:
- `id: string`
- `categories: Category[]`

`Category`:
- `id: string`
- `disciplines: string[]`
- `checkpoints: string[]`
- `summary_files: { [checkpoint: string]: string }`
- `distribution_images: { [checkpoint: string]: string[] }`

`AthleteIndex`:
- `slug: string`
- `display_name: string`
- `entries: AthleteEntry[]`

`AthleteEntry`:
- `event: string`
- `category: string`
- `disciplines: string[]`
- `checkpoints: string[]`

Optional:
- `cross_event_distributions: { [discipline: string]: CrossEventDistribution[] }`

`CrossEventDistribution`:
- `key: string` (contract identifier)
- `label?: string` (UI label)
- `path?: string` (relative asset path; if missing, UI shows placeholder)

Compatibility (temporary):
- `streams` mirror of `events`
- `entries[].stream` mirror of `entries[].event`

## UI Sections and Required Inputs

### 1) Overview (cross-event aggregate)
Expected inputs:
- all event/category summary bundles (`25m`, `50m`, `overview`, `total`),
- cross-event distributions from pipeline (`cross_event_distributions.<discipline>`).

Current status:
- summary bundles: available,
- cross-event distributions: missing.

Fallback behavior:
- aggregate KPIs/tables are computed from available event summaries,
- cross-event distribution panel renders placeholder cards when `path` is missing/not present.

Placeholder contract keys currently expected:
- `distance-cross-event-1d`
- `speed-cross-event-1d`
- `impulse-cross-event-1d`

Overview question mapping (consumer-driven):
| Question surfaced in UI | Expected fields | Available now | Consumer behavior if missing |
| --- | --- | --- | --- |
| Longest distance + associated time | `total.athletes[].distance_m`, `total.athletes[].time_s` | Yes | Render `-` |
| Speed at longest distance + top-distance speed context | `total.athletes[].avg_speed_mps` | Yes | Render `-` |
| Milestone times / training suggestions | `25m.athletes[].time_s`, `50m.athletes[].time_s`, `total.athletes[].time_s`, `total.athletes[].distance_m` | Yes | Keep table rows, mark source as `insufficient data` |
| Cycle-time glide distribution vs total distance | `total.athletes[].cycle.glide_time_s`, `overview.athletes[].cycle_time_s`, `total.athletes[].distance_m` | Yes | Show empty-state in chart card |
| Wall-push glide vs total distance | `total.athletes[].glide_avg_by_label.WALL_PUSH.distance_m`, `total.athletes[].distance_m` | Yes | Show empty-state in chart card |
| Number of cycles vs total distance | `overview.athletes[].cycle_distance_m`, `total.athletes[].distance_m` | Yes | Show empty-state in chart card |
| Cross-event distributions (aggregated artifacts) | `cross_event_distributions.DNF[].path` | No | Show placeholder cards from contract keys |

### 2) Event Explorer (single event/category)
Expected inputs:
- selected event/category summary bundle,
- selected event/category distribution images.

Current status:
- available.

Fallback behavior:
- missing images show section-level empty-state note.

### 3) Athlete Explorer
Expected inputs:
- athlete index entries,
- summary bundle lookup for selected athlete event/category,
- optional peer athlete bundles.

Current status:
- available for current curated dataset.

Fallback behavior:
- missing athlete/event records produce selection-level empty state,
- cohort/peer medians degrade to `-` when inputs are insufficient.

## Availability Matrix
| Contract item | Required by UI | Available now | Fallback/placeholder |
| --- | --- | --- | --- |
| `events[].categories[].summary_files` | Yes | Yes | None |
| `events[].categories[].distribution_images` | Yes (Event Explorer) | Yes | Empty-state note |
| `cross_event_distributions.DNF[]` | Yes (Overview section) | No | Placeholder cards |
| `athletes[].entries[]` | Yes | Yes | None |
| Per-athlete refined solver files in UI | No (v1) | Partial | Not rendered |

## Producer Requests (Pipeline Backlog)
1. Provide cross-event distribution artifacts for DNF and publish through `cross_event_distributions.DNF`.
2. Keep artifact `path` values stable and relative to portal root (`data/...`).
3. Extend same contract shape for `DYNB` and `DYN` when those disciplines activate.

## Acceptance Criteria for Contract Completion
- Overview displays real cross-event distributions (no placeholders for DNF).
- Event Explorer and Athlete Explorer remain contract-compatible.
- `events` remains primary keyset; compatibility keys can be removed only after consumers migrate.
