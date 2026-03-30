# ADR-0001: Local Data Serving with S3 Sync Refresh

- Status: Accepted

## Context

The web portal needs fast iteration against real athlete data from upstream projects.
At this stage we do not have a dedicated backend data service in this repository.
The source artifacts live in S3 and include per-athlete files plus stream-level summaries/distributions.

## Decision

For now, the portal will serve data from local files synchronized from S3.

- Source data is pulled into a local cache via `01_sync_from_s3.py`.
- The app reads cached artifacts directly during local development.
- Refresh happens through an explicit sync process (manual run now, automation later).

## Consequences

- Pros:
  - faster local development without backend/API dependency,
  - deterministic local snapshots for UI and analysis iteration,
  - works offline after a successful sync.
- Cons:
  - local data can become stale between sync runs,
  - developers must run sync before demos, reviews, or validation.

## Operational Notes

- Default cache layout follows stream/category structure under `cache/`.
- Synced source artifacts should be treated as read-only inputs.
- Future work may replace or augment this with a hosted data service, but local sync remains the default until that change is explicitly approved.
