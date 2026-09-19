# Real Connector Integration Standard

本文件定义真实外部系统接入的最低标准。它不指定目标供应商，也不授权在未知 API 下编写 Connector。

## Current Connector SDK Inventory

### Already Available

- Connector manifest、版本和 core API compatibility。
- Connector registry 与 tenant-scoped installation。
- Installation-time config validation。
- `secretRef` 边界与环境变量 secret resolution。
- Safe base URL validation。
- Transport timeout。
- Transactional outbox。
- Worker claim、lease 和并发互斥。
- Retryable / permanent failure classification。
- Fixed retry/backoff、max-attempt 和 dead-letter 状态。
- Stable `Idempotency-Key` across retries and crash recovery。
- Delivery attempt history。
- Success receipt、external identifiers 和 response hash。
- Tenant-scoped outbox、attempt、receipt 查询。
- Reference HTTP connector 与本地 HTTP 端到端验证。
- Inbound envelope / SourceAdapter type boundary。

### Reusable for a Real Read-only Pilot

- Connector manifest and registry。
- Installation and `secretRef` handling。
- Base URL and config validation。
- Tenant isolation patterns。
- Attempt-like run history and stable error codes。
- SourceRecordEnvelope concepts。
- Evidence provenance and downstream Rule / Exception flow。

### Missing or Not Verified

- No formal read-only connector runtime。
- No pagination contract。
- No persisted incremental cursor。
- No `last successful cursor` / `last attempted cursor`。
- No source sync run record with read / accepted / rejected counts。
- No mapping registry or mapping version persistence。
- No formal raw external record storage。
- No OAuth / token refresh contract。
- No provider-specific rate-limit contract or `Retry-After` handling。
- No webhook receiver contract。
- No real sandbox validation。
- No real customer system validation。
- Inbound `SourceRecordEnvelope` currently has no persisted tenant / installation binding。

### Truth Boundary

Current reference HTTP connector is `LOCALLY_VERIFIED`。

It is not:

- Sandbox verified against a customer vendor。
- Real customer system verified。
- Production verified。
- Evidence that ERP、MES、QMS、WMS、bank 或 customer-service systems are connected。

## Integration Intake Requirements

Every real connector integration must answer:

| Required Item | Decision / Evidence |
| --- | --- |
| System name | Exact vendor and product name. |
| Environment | Sandbox、UAT、production、region and network zone. |
| Base URL | Environment-specific endpoint. |
| Authentication | OAuth2、API key、mTLS、signed request or other. |
| Permission scope | Read-only scopes and explicitly forbidden scopes. |
| Rate limit | Requests/minute、concurrency、burst and retry headers. |
| Object | One pilot object only. |
| Fields | One to three approved fields. |
| Unique business key | Stable external identifier. |
| Incremental field | `updatedAt`、sequence、version or equivalent. |
| Pagination | Cursor、offset、page token or vendor-specific mechanism. |
| Time semantics | Event time、updated time、server time、timezone and precision. |
| Error codes | Authentication、permission、rate limit、transient and permanent errors. |
| Idempotency | External key、dedup rule and replay behavior. |
| Retry policy | Retryable classes、max attempts、backoff and stop condition. |
| Receipt | What is stored and what identifies the external record. |
| Webhook | Supported or not supported；signature and replay protection. |
| Data retention | Allowed retention period and deletion process. |
| Redaction | Fields that must not be persisted. |
| Secret management | Delivery method and rotation process. |

## Minimum First Pilot Scope

The first real integration may contain only:

- 1 external system。
- 1 business object。
- 1 business chain。
- 1 to 3 critical fields。
- 1 incremental read direction。
- 1 tenant。
- 1 environment。

The first implementation must be read-only.

The goal is:

```text
External Source
  -> Connector
  -> Normalization
  -> Business Entity / Event
  -> Evidence
  -> Deterministic Rule
  -> Exception
  -> Human Governance
```

## Read-only First Policy

Preferred first objects:

- Order query。
- Shipment query。
- Payment query。
- Complaint query。

Do not begin with external write-back、approval mutation、status mutation、financial posting or customer communication.

Write actions require a separate change scope and a second integration review.

## Connector Acceptance Contract

Every item must be one of:

`PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`

| Acceptance Item | Status | Required Evidence |
| --- | --- | --- |
| Authentication | NOT_TESTED | Successful sandbox read using the approved secret. |
| Pagination | NOT_TESTED | Multiple pages read without duplicates or gaps. |
| Rate Limit | NOT_TESTED | 429 / provider limit response handled deterministically. |
| Timeout | NOT_TESTED | Timeout classified and retried without corrupt state. |
| Retry | NOT_TESTED | Retryable failure retried；permanent failure stops. |
| Idempotency | NOT_TESTED | Replayed external record maps to one canonical fact. |
| Incremental Sync | NOT_TESTED | Cursor advances only after valid commit. |
| Field Mapping | NOT_TESTED | Approved source fields map to approved target fields. |
| Timestamp Semantics | NOT_TESTED | Timezone、event time and updated time verified. |
| Tenant Isolation | NOT_TESTED | One tenant cannot read another tenant’s installation or data. |
| Secret Handling | NOT_TESTED | No secret appears in logs、API responses or persisted payloads. |
| Error Mapping | NOT_TESTED | Provider errors map to stable internal codes. |
| Observability | NOT_TESTED | Run、cursor、counts、errors and timing are inspectable. |
| Evidence Provenance | NOT_TESTED | Evidence traces to source system、external ID、locator、observedAt and raw hash. |

Current status for every real connector is `NOT_TESTED` because `TARGET_SYSTEM_PENDING`.

## Data Boundary

Raw external records cannot create Exceptions directly.

Required path:

```text
Raw External Record
  -> Normalization
  -> Business Entity / Event
  -> Evidence
  -> Deterministic Rule
  -> Exception
```

Every accepted record must retain:

- `sourceSystem`
- external record ID
- `observedAt`
- locator
- raw record hash
- mapping ID and version

The platform must answer:

> Which external system、external record and source fields produced this Exception?

## Mapping Version

Real Pilot mappings must be versioned.

Minimum mapping record:

| Field | Meaning |
| --- | --- |
| mappingId | Stable mapping identity. |
| version | Immutable mapping version. |
| source field | External JSON / record path. |
| target field | Canonical entity、event or Evidence field. |
| transform | Explicit type or value transformation. |
| effectiveAt | Start of mapping validity. |

Mapping changes must not silently overwrite the meaning of historical Evidence.

Current platform gap:

- Mapping code exists in provisioned demo adapters and manifests，but there is no general persisted mapping registry for real connectors.

## Incremental Sync Contract

Preferred cursor:

```text
updatedAt + external unique ID
```

Required state:

- last successful cursor。
- last attempted cursor。
- sync startedAt。
- sync completedAt。
- records read。
- records accepted。
- records rejected。
- last error code。

Commit rule:

- Advance the successful cursor only after the accepted records commit.
- A failed or partially accepted run keeps the prior successful cursor.
- Replays must be idempotent by external unique key.

If the target API only supports pagination and has no reliable incremental field，the limitation must be recorded and the sync must not pretend to be incremental.

## Connector Truth Levels

Use these exact distinctions:

### Connector implemented

Code and contract exist.

### Connector locally verified

Local test server or fixture validated the contract.

### Connector sandbox verified

The vendor or customer-provided sandbox was actually called with approved credentials.

### Connector real customer verified

Real customer records entered the platform and produced traceable Evidence and business results.

### Connector production verified

The connector has operated under production monitoring, retry, security, retention and rollback procedures.

Local success must never be described as real ERP integration.

## Reference Research

These projects were reviewed only for connector contract patterns. None is being introduced or copied.

| Project | Useful Pattern |
| --- | --- |
| Airbyte | Cursor field and incremental append behavior；state prevents re-fetching previously replicated records. |
| Singer | Ordered `RECORD`、`STATE` and `SCHEMA` messages；persisted state resumes a Tap from the prior position. |
| Meltano | Singer-compatible tap / target lifecycle and persisted state used for repeatable incremental extract / load. |
| n8n | Explicit credential separation and error workflows for failed executions and operational diagnosis. |

References:

- https://docs.airbyte.com/using-airbyte/core-concepts/sync-modes/incremental-append
- https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md
- https://docs.meltano.com/
- https://docs.n8n.io/build/flow-logic/handle-errors-gracefully/
- https://docs.n8n.io/integrations/builtin/credentials/

## No Unknown-system Implementation

Until a real target has:

- API documentation。
- test credentials。
- authentication flow。
- sample payloads。
- field semantics。

the project must not create SAP、Kingdee、generic ERP、WMS or other assumed connectors.

The correct artifact is a plan，not speculative code.
