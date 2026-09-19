# Frontend Product Surface Expansion

## Goal

Unify Manufacturing, Operations, and Solution Pack under one React product shell while preserving backend business logic and avoiding fabricated operational metrics.

## In Scope

- Migrate `/operations` from legacy HTML to React.
- Migrate `/workspace` from legacy HTML to React.
- Add a generic React context workspace for non-Manufacturing Solution Pack contexts.
- Use existing analytics, solution pack, workbench, resolution, outcome, and work-item APIs.
- Add focused tests and desktop viewport checks for 1440x900, 1600x900, and 1920x1080.
- Record non-blocking contract and product gaps in `docs/frontend-product-backlog.md`.

## Out Of Scope

- New business engines or fabricated metrics.
- Authorization policy changes.
- Pack-specific Finance application logic.
- Visual redesign of Manufacturing.
- Cleanup of legacy static files.

## Acceptance

- Operations can summarize, filter, inspect, and drill down to business contexts.
- Solution Pack can show installed packs, Pack capabilities, bound contexts, Business Thread, rules, and exceptions.
- Generic Workspace does not rely on Manufacturing-specific fields or copy.
- Main active navigation uses the shared React shell without `reloadDocument`.
- Frontend, E2E, backend, eval, typecheck, and OpenAPI checks pass.
