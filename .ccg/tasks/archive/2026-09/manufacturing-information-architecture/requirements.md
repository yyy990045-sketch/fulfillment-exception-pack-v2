# Manufacturing Information Architecture Rebuild

## Goal

Replace the current single-page Manufacturing workspace with a true List Page -> Record Page -> Task Route information architecture.

## Required Structure

- `/manufacturing/:contextId`: Context Page with Header, Digital Thread, queue search/filter/sort, and no exception detail.
- `/manufacturing/:contextId/exceptions/:exceptionId/overview`: understand what happened.
- `/evidence`: verify facts only.
- `/analysis`: understand why, using facts and hypotheses only.
- `/decision`: choose a recommendation, then navigate to governance.
- `/governance`: manage the governance process with only the current step expanded.

## Constraints

- Do not change Backend business logic.
- Reuse existing APIs and domain objects.
- Preserve queue filters and scroll position through browser Back.
- Remove duplicate buttons whose destination content is already visible.
- Keep technical detail inside the existing details Sheet.

## Acceptance

- Context Page does not render exception detail, evidence, analysis, decision, or governance.
- Exception Record Page does not render the full exception queue or full Digital Thread.
- Each sub-route renders only its task-specific workspace.
- Real browser flow passes at 1440x900, 1600x900, and 1920x1080.
- Existing frontend, E2E, backend, typecheck, eval, and OpenAPI checks pass.
