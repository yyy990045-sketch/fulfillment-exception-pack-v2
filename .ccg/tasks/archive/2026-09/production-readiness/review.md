# Production readiness review

## Verification performed

- `npm test -- --run`: 3 files, 33 tests passed.
- `npm run typecheck`: passed.
- Ruby YAML parse of `contracts/openapi.yaml`: OpenAPI 3.0.3, 12 paths, all current `/api` methods present.
- Local API smoke: production mode rejects forged demo headers with 401, accepts a locally signed HS256 bearer, SQLite backend reads/writes, and capability outcome records read back after restart-equivalent process access.
- Local endpoint smoke: refresh selects the fallback endpoint after primary invalid CSV and records both attempts.
- EGo browser: loaded `http://localhost:3486/`, reviewed both FX-002 evidence conflicts until the UI showed `差异已全部核对` and `处理与结案 下一步`; verified the more-capability page displays the persisted outcome record; verified sandbox copy states it does not write receipts.
- Docker Compose config parses when an ephemeral `AUTH_SECRET` is supplied. Docker image build was not runnable because the local Docker daemon was unavailable.

## Findings and boundaries

- The new auth path is a local HS256 verifier and production fail-closed gate, not a complete enterprise IdP/OIDC integration. Tenant membership must still be supplied by the token issuer or an adapter in the target environment.
- SQLite WAL transactions are implemented and selected by configuration. Backup, migrations, connection pooling, and multi-replica operational behavior remain deployment acceptance checks.
- `execute` continues to emit the existing `mock-receipt:` marker for the synthetic demo; no external CRM/ERP write was invented without a configured target contract. Capability `more/outcome` writes are durable local records and audit events.
- EGo prompt automation intermittently timed out while opening the native browser prompt; the same write was verified through the local API and then read back visibly in EGo.

