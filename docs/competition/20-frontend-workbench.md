# 1 Tech Stack

Frontend Phase F1 introduces a presentation-only React application under `frontend/`.

```text
React 19
TypeScript
Vite
Tailwind CSS
shadcn/ui source components
lucide-react
TanStack Query
React Router
```

The existing Node HTTP Server, REST APIs, SQLite store, Domain layer, Rule Engine, Exception Engine, Policy, Automation, Connector, and Outcome runtime remain in place.

# 2 Architecture

```text
Existing Node Server
  -> /api/v2 REST projection
  -> React presentation layer
  -> Manufacturing Decision Workbench
```

The frontend does not evaluate rules and does not decide policy eligibility.

# 3 Information Hierarchy

The Manufacturing page is organized as:

1. Application shell and compact demo identity controls.
2. Context Header for the active business key and status.
3. Digital Thread for the eight fulfillment stages.
4. Exception Rail for current deterministic exceptions.
5. Selected Exception Header and Overview.
6. Evidence list and Evidence inspector.

No KPI-card grid, fake AI confidence, chart decoration, or business-value literals are introduced in the frontend.

# 4 Route Design

```text
/manufacturing/:contextId
/manufacturing/:contextId/exceptions/:exceptionId
/manufacturing/:contextId/exceptions/:exceptionId/evidence
```

The evidence inspector adds `?evidence=<evidenceId>` to the current URL. These routes support direct links, browser forward, and browser back behavior.

# 5 API Boundary

The frontend uses same-origin `/api/v2` requests only.

`frontend/src/api/client.ts` centralizes:

- `Authorization`
- `x-tenant-id`
- `x-actor`
- JSON body handling
- JSON error parsing

API schema types are generated from `contracts/openapi.yaml` into `frontend/src/api/schema.d.ts`. UI-specific ViewModels narrow the generated loose projection schemas without introducing a second backend contract.

# 6 Vite and Node Integration

Development:

```text
Vite dev server -> /api proxy -> existing Node server
```

Production:

```text
Vite build -> frontend/dist
Node server -> /manufacturing and /manufacturing/* SPA routes
```

`/api/*` is never handled by the SPA fallback.

# 7 Evidence-first Workbench

The selected exception exposes:

- Overview for the core discrepancy, API metrics, related stages, and rule evaluations.
- Evidence as a dense row list.
- Evidence inspector for source system, document, version, quote, locator, observed time, and Evidence ID.

Customer claim Evidence remains labeled as `客户主张`; it is not rewritten as actual receipt.

# 8 Loading, Error, and Empty States

- Loading uses local skeletons.
- Workbench and Evidence query errors are displayed locally.
- Empty Evidence uses the concise message `暂无相关证据`.

# 9 Accessibility

- Interactive rows and rail items use button semantics.
- Selected exceptions expose `aria-current`.
- Tabs use Radix tab semantics and `aria-selected`.
- Keyboard focus uses visible focus outlines.

# 10 Legacy Fallback

The old static Manufacturing files remain in `src/workbench/manufacturing/`.

They are available at:

```text
/manufacturing-legacy
/manufacturing-legacy/styles.css
/manufacturing-legacy/app.js
```

The legacy V1 `/` page and the existing Operations and Workspace pages remain unchanged.

# 11 Phase F1 Scope

Included:

- Application Shell
- Context Header
- Digital Thread
- Exception Rail
- Selected Exception Overview
- Evidence list and inspector
- URL deep links
- Loading, error, and empty states
- Node serving integration

Not included:

- Grounded AI
- Root Cause
- Decision Recommendation
- Policy mutations
- Resolution mutations
- Approval
- Execution
- Outcome migration
- Operations migration
- Workspace migration

# 12 Truthfulness Boundary

```text
REACT_FRONTEND_IMPLEMENTED=true
TAILWIND_CSS_USED=true
SHADCN_UI_USED=true
MANUFACTURING_FRONTEND_MIGRATED=true
OPERATIONS_FRONTEND_MIGRATED=false
WORKSPACE_FRONTEND_MIGRATED=false
BUSINESS_RULES_IN_FRONTEND=false
POLICY_LOGIC_IN_FRONTEND=false
FAKE_AI_METRICS=false
```
