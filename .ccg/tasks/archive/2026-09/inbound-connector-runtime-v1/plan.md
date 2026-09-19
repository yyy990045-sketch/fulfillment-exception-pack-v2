# Plan

1. Define inbound connector, envelope, sync run/state, ledger, mapping, and error contracts.
2. Add migration 016 and tenant-scoped SQLite Store methods.
3. Implement `runInboundSync` with page limits, canonical commit boundaries, duplicate detection, and cursor finalization.
4. Add a reference inbound HTTP connector and minimal source adapter for the existing fulfillment rule pipeline.
5. Add runtime, crash, retry, provenance, idempotency, mapping, and regression tests.
6. Update commercial readiness and run full regression.
