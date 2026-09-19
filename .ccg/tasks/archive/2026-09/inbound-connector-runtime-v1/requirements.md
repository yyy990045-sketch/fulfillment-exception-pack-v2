# Inbound Connector Runtime V1

- Add a provider-neutral read-only InboundConnector contract.
- Persist sync runs, sync states, source-record ledger, and mapping versions.
- Advance the successful cursor only after canonical commit.
- Keep outbound connector behavior compatible.
- Add a local reference inbound connector and adapter.
- Verify pagination, duplicate/revision, crash replay, retry, rate limit, mapping version, provenance, and tenant isolation.
- Update only the Inbound Connector Runtime truth boundary in commercial readiness.
