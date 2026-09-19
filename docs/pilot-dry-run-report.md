# Pilot Readiness Dry Run Report

## Final Gate

PILOT_READY

所有 Gate：

| Gate | Status |
| --- | --- |
| Clean install | PASS |
| Cold start | PASS |
| Demo flow | PASS |
| Restart | PASS |
| Backup / restore | PASS |
| Core auth smoke | PASS |
| P0 | 0 |

## Environment

| Item | Value |
| --- | --- |
| Runtime | Clean-room local clone |
| Temporary directory | `/tmp/fep-pilot-dry-run-13hAjh` |
| Repository | `/tmp/fep-pilot-dry-run-13hAjh/repo` |
| Commit SHA | `8c5d4778094bf6dcb3e5fe9ed10d41e0227c1d3a` |
| Node | `v24.18.0` |
| npm | `11.16.0` |
| Migration head | `015_solution_pack_context_bindings` |
| Frontend JS | `frontend/dist/assets/index-DlKwX6gJ.js` |
| Frontend JS SHA-256 | `277c5313b13621a30719dd512fd8f226a3e9c09fe5fc31e8ed4ec48457a62f4b` |
| Frontend HTML SHA-256 | `c5158d564955afd98add738ad0ca3b93f047ce1bc8d0ed330867e5304d40ffa7` |
| CSS SHA-256 | `1d54a117037ac2a08dbcce775822969a026a868a1061befb9da8436e62e5d2f6` |

## Clean Install

Status: PASS

- `git clone --no-local` created a new repository checkout.
- The working tree started clean at the recorded SHA.
- No existing SQLite database, `frontend/dist`, preview server, or browser storage was reused.
- `npm ci` installed 288 packages.
- `npm run typecheck` passed.
- `npm test`: 60 files passed, 336 tests passed.
- `npm run frontend:build` passed.
- Two consecutive clean builds produced the same JS hash.
- Production dependency audit with `--omit=dev`: 0 vulnerabilities.
- Full install audit reported 5 dev/test-toolchain findings: 3 moderate, 1 high, 1 critical. This is recorded as P2 supply-chain hardening and did not affect production runtime dependencies.

## Cold Start

Status: PASS

- Started an empty database on port `3620`.
- `GET /api/health` returned HTTP 200 with `{"ok":true}`.
- All migrations `001` through `015` applied automatically.
- Initial empty database contained no Pack installation or Context binding.
- Ran `demo:packs:prepare`, `demo:operations:prepare`, and `demo:outcomes:prepare`.
- The resulting store contained Manufacturing and Finance demo Packs, Contexts, Rules, Exceptions, Resolution data, receipts, and Outcome measurements.
- `manufacturing-fulfillment` exposed 11 `boundContexts`, including `ctx-so-mfg-001`.
- The live frontend loaded the current hashed bundle.

## Demo Flow

Status: PASS

Playwright clean-browser flow:

- Operations
- SO-MFG-001
- Exception
- Evidence
- Analysis
- Decision
- Governance
- Receipt
- Outcome
- Solution Pack
- Demo Organization switch
- Finance Reconciliation
- Generic Workspace

Observed:

- `frontend:e2e`: 5 tests passed.
- A fresh Playwright context collected zero console errors, page errors, request failures, HTTP 404, HTTP 500, raw field keys, or stale bundle references.
- Final URL: `/workspace/ctx-fin-rec-001`.
- Finance Workbench returned `pack=finance-reconciliation`, Context `REC-FIN-001`, and labeled facts.
- SO-MFG-001 Outcome displayed the measured Observation boundary: the UI explicitly stated that measurement does not prove that a prior action caused the result.

## Bearer Smoke

Status: PASS

Bearer-only server configuration:

- `DEMO_MODE=false`
- `NODE_ENV=production`
- `AUTH_SECRET` supplied through the process environment

Verified:

- `/api/v2/auth/context` returned organization claim, `subjectId`, roles, and `jwt-hs256`.
- Viewer mutation was denied with HTTP 403.
- SoD capability projection denied the same subject that proposed the Resolution.
- SoD mutation was denied with `SEGREGATION_OF_DUTIES_VIOLATION`.
- Independent approver approved a pending Resolution.
- Independent executor executed and closed the Resolution.
- Receipt retained the actor and event chain.
- Cross-tenant Workbench request returned HTTP 404.

## Restart

Status: PASS

- Stopped and restarted the same database.
- Migrations were not duplicated.
- Migration count remained 15.
- Context count remained 12.
- Exception count remained 38.
- Resolution count remained 8.
- Resolution receipt count remained 3.
- Outcome measurement count remained 7.
- Pack binding count remained 12.
- `ctx-so-mfg-001` retained the same `boundAt`, `boundBy=demo-system`, and `source=pack_provision`.

## Backup / Restore

Status: PASS

Rehearsal:

1. Ran SQLite `PRAGMA wal_checkpoint(TRUNCATE)`.
2. Copied the database to a backup directory.
3. Copied the current production environment example.
4. Stopped the service.
5. Created a new restore directory.
6. Restored the database and configuration example.
7. Started the service from the restored directory on port `3622`.

Restore verification:

- Health: HTTP 200.
- SO-MFG-001 existed.
- Exceptions: 38.
- Resolution Cases: 8.
- Resolution receipts: 3.
- Outcome measurements: 7.
- Manufacturing Pack binding count: 12.
- `ctx-so-mfg-001` binding timestamp and provenance were unchanged.

## Upgrade

Status: PASS

The rehearsal created a database with:

- Context present.
- Pack installation present.
- RuleEvaluation present.
- Migration `015` absent.
- Explicit binding absent.

Current main startup:

- Applied migration `015_solution_pack_context_bindings`.
- Registered built-in Packs.
- Backfilled `ctx-so-mfg-001` with `bound_by=migration` and `source=migration_backfill`.
- `/solution-packs/installed` returned the bound Context.

Second startup:

- Did not create a duplicate binding.
- Did not change `boundAt`, `boundBy`, or `source`.
- Migration count remained 15.

## Failure Scenarios

| Scenario | Status | Observed Behavior |
| --- | --- | --- |
| Port occupied | PASS | Explicit `EADDRINUSE`; process did not advertise a false healthy state. |
| DB file unwritable | PASS | Explicit `unable to open database file`; no partial business state was produced. |
| AUTH_SECRET missing | PASS | Explicit `AUTH_SECRET_REQUIRED_IN_PRODUCTION`; server did not start. |
| Invalid JWT | PASS | HTTP 401 `invalid_token`. |
| Unknown tenant | PASS | HTTP 404 `not_found`; cross-tenant Context was not exposed. |
| Pack binding ambiguity | PASS | Startup failed closed with `PACK_CONTEXT_BINDING_AMBIGUOUS`. |
| AI provider unconfigured | PASS | HTTP 503 `GROUNDING_AI_PROVIDER_REQUIRED`; no fabricated AI result was returned. |
| Connector unavailable | PASS | HTTP 404 `CONNECTOR_NOT_FOUND`; no delivery receipt was created. |

The ambiguity scenario demonstrates the known P1 multi-tenant production risk: one ambiguous tenant can currently block the entire server startup. This remains acceptable only for a controlled single-tenant Pilot.

## Security / Logs

Status: PASS

- Startup and failure logs contained no API key, JWT value, connection string, or secretRef value.
- The missing-secret failure printed the environment variable name in the Node stack, but not its value. This is recorded as P2 log-hardening work.
- Resolution audit data retained actor, object, action, result, and timestamps.
- Resolution receipts stored safe source, status, request identifier, and timestamp.

## Performance Smoke

Status: PASS

Local 1600x900 browser smoke:

| Operation | Result |
| --- | --- |
| Initial Operations load | 590 ms wall time |
| DOM content loaded | 24.4 ms |
| Operations API | 41.82 ms |
| Workbench API | 5.67 ms |
| Evidence API | 1.95 ms |
| Analysis API | 1.26 ms |
| Decision API | 1.03 ms |
| Governance mutation | 4.33 ms |
| Duplicate request storm | None detected |

No seconds-level local request latency, infinite refetch, or bundle loading failure was observed.

## Production Gaps

### P0 — Pilot Blocker

0

### P1 — Production Blocker

1. Multi-tenant bootstrap isolation: one ambiguous tenant currently fails the entire server startup. This is accepted only for a controlled single-tenant Pilot.
2. One-shot Pilot bootstrap script: clean data currently requires separate Pack, Operations, and Outcome prepare commands.
3. External connector validation: no real ERP, MES, QMS, WMS, bank, or customer task system validation.
4. Formal identity / RBAC administration remains incomplete.
5. Production observability remains incomplete.

### P2 — Scale / Polish

1. Frontend bundle chunk warning.
2. Page query fragmentation and local loading polish.
3. Legacy static surface cleanup.
4. Log hardening so failure stack output does not print environment-variable identifiers.
5. Advanced queue filters and saved views.
6. Dev/test toolchain dependency audit: 3 moderate, 1 high, and 1 critical advisory; production dependencies are clean.

## Summary

The controlled single-tenant Pilot path is ready. External-system production integration and multi-tenant production operations are not ready and remain explicitly classified as P1.
