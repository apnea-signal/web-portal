# Business Context: Web Portal

## Decision References
- [ADR-0001: Local Data Serving with S3 Sync Refresh](./decisions/0001-local-data-serving-with-s3-sync-refresh.md)

## Purpose
The web portal turns upstream apnea analysis artifacts into practical, athlete-facing feedback.

The portal must do two things well:
- help an athlete understand training targets they should aim for,
- let athletes compare their stats with other athletes when they have a processed video in the system.

## Users and Decisions
### Athletes
- understand target pacing and propulsion benchmarks,
- see where they are above or below cohort references,
- identify specific training focus areas for the next block.

### Coaches and Analysts
- review athlete progression against comparable peers,
- detect technique and efficiency gaps quickly,
- use standardized stats for squad-level review.

## Pipeline Position and Data Contracts
This portal is a downstream visualization layer in the apnea-signal pipeline.

Upstream sources:
- `video-annotation` produces `*.annotations.json` with metadata and frame labels,
- `propulsion-solver` provides `*.propulsion.refined.json` and `*.propulsion.stats.json` for portal consumption.
- additional solver-derived analysis artifacts (summaries and distributions) support cohort and benchmark views.

Contract precedence for portal metrics:
- solver outputs are the source of truth for displayed performance metrics,
- annotation output is contextual metadata and provenance.

Canonical consumer contract details are documented in
[`docs/data-contract.md`](./data-contract.md).

## Product Behavior
### Mode A: No processed video for the athlete
- show benchmark targets only,
- do not show personal-vs-cohort deltas,
- show a footer note that personalized views require processed video and include contact instructions.

### Mode B: Processed video available
- show athlete-specific metrics and trends,
- show athlete-vs-cohort comparisons and deltas,
- surface clear training takeaways tied to specific metric gaps.

### Cohort Rule
Default comparison cohort is athletes in the same discipline.

## UX Principles (inspired by `energy-model-old`)
- start with an overview, then allow drill-down into detailed sections,
- combine charts with plain-language “training takeaways”,
- use benchmark bands and reference lines to make targets visible,
- support athlete highlighting/filtering to simplify comparisons,
- keep comparisons interpretable over model-heavy terminology.

## Metric Availability Matrix
| Capability | No processed video | Processed video available |
| --- | --- | --- |
| Cohort benchmark targets | Yes | Yes |
| Athlete-specific performance stats | No | Yes |
| Athlete-vs-cohort delta views | No | Yes |
| Personalized training takeaways | Limited (benchmark-only) | Yes |

## Non-Goals
- generating new authoritative performance metrics inside the portal,
- replacing annotation or solver responsibilities,
- automatic coaching prescriptions without coach interpretation.

## Future Work
- source-integration roadmap: [`docs/data-sources-strategy.md`](./data-sources-strategy.md),
- canonical consumer contract: [`docs/data-contract.md`](./data-contract.md).
