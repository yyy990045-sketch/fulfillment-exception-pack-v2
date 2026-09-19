# Full Product UI Consistency

## Goal

Make Manufacturing, Operations, Solution Pack, and Generic Workspace feel like one mature B2B product without adding business capabilities.

## Scope

- Shared page width, Header, Section, Summary Strip, Local State, Severity Badge, and status formatter.
- Remove raw severity/status/capability enums from the primary business UI.
- Refine the Operations portfolio, filters, insight sections, and table behavior.
- Separate Generic Workspace rules, exceptions, governance, and outcomes.
- Preserve Backend, authorization, Pack binding, and business-engine behavior.

## Acceptance

- The required routes render in a real browser at 1440x900, 1600x900, and 1920x1080.
- No horizontal page overflow or raw internal enum leakage.
- Operations drill-down, Solution Pack context selection, and Generic Workspace rendering remain functional.
- Existing frontend, E2E, backend, typecheck, eval, and OpenAPI checks pass.
