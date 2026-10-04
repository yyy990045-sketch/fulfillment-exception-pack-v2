# J1 Review

## Scope

Reviewed the working-tree changes for the Phase J1 Judge Path Convergence request, including the Judge Contract projection, simulator source facts, manifest API, Judge page, and the short contract document.

## External review attempts

- `antigravity reviewer`: unavailable because the local wrapper could not find the `agy` executable (`agy command not found in PATH`).
- `claude reviewer`: unavailable because the configured wrapper model was rejected (`unrecognized_model MiniMax-M3[1m]`).

No project files were sent to an external service successfully.

## Local findings and disposition

- **Critical: none.** The final local API response uses `SO-IND-001`, `FULFILLMENT_STATE_CONFLICT@1.0`, and all four required source systems. The default Judge endpoint now reads the isolated Judge database and artifacts together, so evidence and Contract projections do not mix with the default application database.
- **Warning: fixed.** Case E initially changed WMS quantity without advancing the watermark. The projection now advances all source progress values and exposes `07:00 → 08:00` for revalidation.
- **Warning: fixed.** The Judge endpoint initially combined a fresh Contract artifact with an old application database, producing an evidence gate mismatch. It now opens `.preview/judge-demo/pack-cases.sqlite` for the default Judge view.
- **Warning: fixed.** The rules section initially read `unknown / not_matched` from the old database even when the Contract reported a conflict. It now projects the Contract code and 100/96 matched result when the Contract is present.
- **Info: residual limitation.** The demo remains simulated and `REAL_OPEN_SUPOS_RUNTIME_VERIFIED=false`, as required by the request.

## Local verification evidence

- `npm run demo:judge -- --ai none --speed 0` returned `JUDGE_DEMO_VERIFIED` and printed A-E statuses.
- `npm run typecheck` completed successfully.
- `npm run frontend:build` completed successfully.
- `npm run frontend:test -- --run src/features/judge/judge-page.test.tsx` passed all 4 targeted tests.
- Live API returned `currentCase=C`, `sourceSystems=[ERP,MES,QMS,WMS]`, `trace=EVIDENCE_TRACE_VERIFIED`, and E watermark `2026-09-04T08:00:00.000Z`.
- Playwright verified the live Judge page at desktop and 390px mobile viewports; both had no horizontal overflow and showed the four source facts, Watermark, Lineage, Current Result, and Judge Path A-E.
