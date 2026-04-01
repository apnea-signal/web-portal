# Data Sources Strategy

## Goal
Define how source integrations evolve over time while the portal keeps one stable consumer contract.

The canonical contract and availability matrix live in:
- [`docs/data-contract.md`](./data-contract.md)

## Strategy Focus
- prioritize producer work that removes UI placeholders with high athlete/coaching value,
- keep manifest and artifact paths stable to avoid consumer churn,
- isolate compatibility bridges (`streams` -> `events`) and remove them only after migration.

## Current Priorities
1. Fill DNF cross-event distributions (`cross_event_distributions.DNF`) so Overview can replace placeholders with real artifacts.
2. Keep event/category summary and distribution production stable for Event Explorer.
3. Extend the same contract shape for DYNB and DYN once those disciplines activate.

## Decision Targets
- source freshness policy for curated snapshots,
- ownership per artifact family (annotation vs solver outputs),
- deprecation date for compatibility keys in manifest.

## Done Criteria
- all required items in [`docs/data-contract.md`](./data-contract.md) are producer-backed,
- Overview has no placeholder cards for active disciplines,
- compatibility keys are formally deprecated and removed with a migration note.
