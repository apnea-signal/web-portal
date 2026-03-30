# Data Sources Strategy (Planned)

## Goal
Define how the web portal can progressively use all available upstream data sources while keeping one clear source of truth for athlete-visible metrics.

## Scope for This Future Document
- inventory every upstream artifact and owner,
- classify each field as authoritative metric, contextual metadata, or optional enrichment,
- define join keys and freshness expectations,
- document fallback behavior when inputs are missing or stale,
- prioritize integrations by athlete/coaching impact.

## Initial Source Inventory
- `video-annotation`: `*.annotations.json`
- `propulsion-solver` (portal baseline): `*.propulsion.refined.json`, `*.propulsion.stats.json`
- `propulsion-solver` derived analysis artifacts: checkpoint/cohort summary JSON and distribution outputs
- legacy inspiration: `energy-model-old` dashboard datasets and presentation patterns

## Decision Targets
- when to show benchmark-only vs personalized views,
- where derived portal metrics are allowed and how they are labeled,
- how cohort definitions evolve beyond the default same-discipline rule.

## Done Criteria
- clear data contract map for each portal section,
- explicit source-of-truth statement per displayed metric,
- implementation-ready backlog for staged data-source adoption.
