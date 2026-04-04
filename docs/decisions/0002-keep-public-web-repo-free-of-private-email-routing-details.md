# ADR-0002: Keep Public Web Repo Free of Private Email Routing Details

- Status: Accepted

## Context

The `web-portal` repository is public because it hosts static pages.
Embedding infrastructure details for inbound email forwarding in a public repo would expose sensitive routing metadata and increase spam/abuse risk.

We still need a public project contact address in the footer, but private forwarding details must not be stored in this repository.

## Decision

Email routing infrastructure for `@apneasignal.com` inbound contact will live in the private `infra-aws` repository.

- `web-portal` will only contain public-facing contact UX.
- `web-portal` will not contain Terraform or runtime config that reveals private routing destinations.
- `infra-aws` will own SES/Route53/Lambda wiring and operational docs for inbound forwarding.

## Consequences

- Pros:
  - reduces exposure of private routing configuration in a public repository,
  - keeps static site source focused on presentation,
  - centralizes operational responsibility for email routing in the private infra codebase.
- Cons:
  - introduces cross-repo coordination when updating contact UX and routing behavior,
  - requires keeping docs in sync between product and infrastructure repositories.

## Operational Notes

- Public site changes may reference the visible contact address only.
- Any forwarding destination changes are implemented and reviewed exclusively in `infra-aws`.
- Infra design and runbook details are documented under `infra-aws/docs/design/`.
