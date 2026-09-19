# 1 Solution Pack vs Connector

A Solution Pack defines industry semantics.

A Connector defines reliable exchange with an external system.

The two are independent and may be reused across packs.

# 2 Connector SDK

The Connector Core defines:

- manifest and compatibility version
- registry
- installation
- secret references
- safety gates
- transactional outbox
- lease worker
- delivery attempts and receipts
- inbound SourceRecordEnvelope and SourceAdapter contracts

# 3 Tenant Installation

Installation stores:

- connector ID and version
- tenant-scoped installation ID
- config
- optional secret reference
- manifest hash

Installation performs no network request.

# 4 Secret Boundary

The database stores only a `secretRef`.

Secret-ref values are resolved at delivery time from the environment.

Secrets are never returned by API or stored in attempts, outbox, receipts, errors, or response hashes.

# 5 Internal Work Item as Stable Effect

The Connector layer delivers an Internal Work Item.

It does not construct arbitrary AI-generated HTTP payloads.

The payload is a deterministic projection of the Work Item.

# 6 Why External HTTP Cannot Live in DB Transaction

A database transaction cannot atomically cover a third-party HTTP side effect.

Therefore the local transaction writes the Outbox row and commits before any network call.

# 7 Transactional Outbox

Flow:

```text
InternalWorkItem
→ connector_outbox commit
→ Worker claim/lease
→ external HTTP outside transaction
→ local finalize transaction
→ attempt + receipt
```

# 8 Lease and Worker

Workers claim pending, failed, or expired in-flight items in a transaction.

The network call happens outside the transaction.

# 9 Remote Idempotency

Every request carries:

```text
Idempotency-Key: <operationKey>
```

The operation key is stable across retries and crash recovery.

# 10 Retry / Dead Letter

Retryable:

- network errors
- timeouts
- HTTP 408
- HTTP 429
- HTTP 5xx

Permanent 4xx responses become `dead_letter`.

Default max attempts is 3 with deterministic backoff.

# 11 Receipt

Receipt is created only after successful external delivery.

It stores safe external identifiers and a response hash, not the full external response.

# 12 Transport vs Source Adapter

Connector owns transport, authentication, retry, and receipts.

SourceAdapter owns mapping external records into canonical domain facts.

Connectors do not directly create Exceptions.

# 13 Reference HTTP Connector

`reference-internal-task-http` is a local proof connector.

It posts deterministic Internal Work Item payloads to:

```text
POST <baseUrl>/tasks
```

It is not a production ERP, WMS, bank, enterprise messaging, or customer connector.

# 14 Cross-Pack Reuse

The same reference connector can deliver Manufacturing or Finance Internal Work Items.

Neither Solution Pack imports the connector, and the connector imports neither pack.

# 15 open supOS Boundary

Open supOS remains an inbound integration boundary.

Phase 12 does not enable Open supOS outbound.

`REAL_OPEN_SUPOS_RUNTIME_VERIFIED` remains false unless explicitly verified.

# 16 Future H3Yun / WeCom / Douyin / ERP Connectors

Future connectors implement the same Connector SDK and outbox contracts.

They must not introduce pack-specific business rules into the transport layer.

# 17 Truthfulness

```text
CONNECTOR_SDK_IMPLEMENTED = true
CONNECTOR_OUTBOX_IMPLEMENTED = true
REMOTE_IDEMPOTENCY_SUPPORTED = true
REFERENCE_HTTP_CONNECTOR = true
REAL_EXTERNAL_REFERENCE_HTTP_VERIFIED = true
REAL_ERP_INTEGRATION = false
REAL_WMS_INTEGRATION = false
REAL_WECHAT_WORK_INTEGRATION = false
REAL_H3YUN_INTEGRATION = false
REAL_DOUYIN_INTEGRATION = false
REAL_BANK_INTEGRATION = false
OPEN_SUPOS_OUTBOUND_ENABLED = false
```

`REAL_EXTERNAL_REFERENCE_HTTP_VERIFIED=true` refers only to the local test HTTP server.
