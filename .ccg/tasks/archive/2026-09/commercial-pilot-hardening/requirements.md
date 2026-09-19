# Commercial Pilot Hardening

## Goal

Close the remaining cross-module pilot blockers without changing the current visual hierarchy or adding product surfaces.

## Required Outcomes

- High-impact confirmation sheets stay open on mutation failure, show a business error, and allow retry.
- Exception Queue consumes a backend `governanceStage` projection instead of rebuilding state from status and actions.
- Installed Solution Packs expose backend-derived bound contexts rather than relying on `contextType`.
- Demo mode can switch organizations entirely through the UI, with tenant-scoped caches and safe route fallback.
- Technical metadata has consistent audit-detail entry points and does not leak into primary business labels.
- Operational trend buckets expose `label`, `from`, and `to` and no longer require bucket-key parsing.
- Solution Pack projections expose backend-derived supported action labels.
- A Playwright customer pilot flow covers the read path, governance mutations, organization switching, and finance generic workspace without tenant-header route hacks.

## Boundaries

- Do not change the existing visual baseline or information architecture.
- Do not add pages, dashboards, rules, packs, AI capabilities, or RBAC administration.
- Keep production Bearer mode free of demo organization switching.
- Keep final authorization and mutation validation on the backend.
