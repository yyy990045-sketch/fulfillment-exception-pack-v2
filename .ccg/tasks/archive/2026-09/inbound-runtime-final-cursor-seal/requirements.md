# Inbound Runtime Final Cursor Seal

- Keep `run.committedCursor` equal to `state.lastSuccessfulCursor` on every return path.
- Compute downstream pending by reading the current page ledger rows.
- Fail closed with `DOWNSTREAM_PROCESSING_INCOMPLETE` if downstream marking leaves pending rows.
- Add invariant tests for single-page, multi-page, rejected, crash, and injected mark failure.
