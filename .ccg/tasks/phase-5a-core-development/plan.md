# Phase 5A implementation plan

1. Add explicit result provenance and scenario input fingerprint to the standard result model and frontend state without exposing internal hashes in the primary business surface.
2. Make the effects page use the current computed result for standard scenarios, while keeping the frozen v1/v2 comparison as historical evidence.
3. Add a business-facing SKU/package preparation flow that deterministically expands declared packaging rules into cargo records, then validates and submits the complete standard scenario.
4. Add a business-facing loading/unloading work-order summary and export metadata for confirmed plans.
5. Verify the complete flow with direct 8114 requests and browser interactions; do not alter v1/v2 frozen data.
