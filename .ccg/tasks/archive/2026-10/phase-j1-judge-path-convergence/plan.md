# J1 Implementation Plan

1. Extend the existing industrial mapping and deterministic simulator metadata so
   the main `SO-IND-001` story carries ERP due time, QMS release quantity, WMS
   `executionCommittedQty`, and explicit cross-system relation references.
2. Add a small `src/demo/judge/contract.ts` projection/evaluator for the single
   Judge Contract v1.0. It defines cases A-E and keeps observed conflict,
   governed disposition, and closure/revalidation as separate facts.
3. Route the default `demo:judge` run through that projection while retaining the
   existing simulation, connector, evidence, and isolated workspace. Persist the
   contract projection beside the existing evidence manifest so the server can
   serve the same result.
4. Extend the existing manifest API shape with a `fulfillment` section and update
   the Judge page to lead with ERP/MES/QMS/WMS facts, lineage, watermark, current
   result, external obligation, and an A-E case control.
5. Add the short Judge Contract v1.0 document and record review evidence. Verify
   the CLI, frontend build, targeted Judge page checks, and direct browser flow.

Out of scope: real open supOS runtime integration, new industrial scenarios,
generic lineage/event-streaming/permission frameworks, and broad test-suite work.
