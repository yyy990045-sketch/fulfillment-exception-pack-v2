# First Real Pilot Integration Plan

## Target

`TARGET_SYSTEM_PENDING`

本计划不假设 SAP、Kingdee、ERP、MES、QMS、WMS 或任何具体供应商。收到真实 intake、测试账号、API 文档和样例 payload 后，才选择对象和字段。

## Goal

把第一个真实外部系统的最短只读链路推进到：

`REAL_EXTERNAL_RUNTIME_VERIFIED`

目标数据路线：

```text
真实业务对象
  -> 真实来源字段
  -> 平台 Evidence
  -> Deterministic Rule
  -> Exception
  -> 人工核验
  -> 治理
```

最终必须回答：

> 这条异常由哪个外部系统、哪条真实记录、哪几个字段产生？

## Minimum Scope

- 1 system。
- 1 business object。
- 1 business chain。
- 1 to 3 critical fields。
- 1 read-only incremental direction。
- 1 tenant。
- 1 sandbox or UAT environment。

Recommended first object, after intake:

- Order query。
- Shipment query。
- Payment query。
- Complaint query。

Do not start with:

- Full ERP integration。
- Order + inventory + finance + complaint in one release。
- Bidirectional sync。
- Dozens of endpoints。
- External write-back。
- Automatic external execution。

## Recommended Reference Data Route

Example shape only；field names remain pending:

```text
External order / shipment / payment / complaint record
  -> Raw external hash
  -> Versioned mapping
  -> Business Entity / Event
  -> Evidence
  -> Deterministic Rule
  -> Exception
```

Required provenance:

- `sourceSystem`
- external ID
- `observedAt`
- locator
- raw hash
- mapping ID
- mapping version

## Current SDK Reuse

Can reuse:

- Manifest and registry。
- Tenant-scoped installation。
- Config validation。
- `secretRef` and environment secret resolution。
- Safe URL and timeout handling。
- Tenant isolation patterns。
- Attempt / receipt style safety。
- SourceRecordEnvelope / SourceAdapter concepts。
- Evidence and deterministic Rule pipeline。

Must add later, after intake:

- Read-only connector lifecycle。
- Pagination。
- Persisted incremental cursor。
- Sync run counters。
- Mapping version persistence。
- Raw external record hash / locator persistence。
- Provider error mapping。

## Required Customer Materials

The Pilot is `BLOCKED` until the customer provides:

1. Completed `docs/real-integration-intake.md`。
2. API documentation or OpenAPI document。
3. Test environment Base URL。
4. Test account and authentication method。
5. Read-only permission scope。
6. One object and one to three fields。
7. Unique business key。
8. Incremental field and time semantics。
9. Pagination rule。
10. Sample response with sensitive data redacted。
11. Rate limit and retry headers。
12. Secret delivery and rotation process。
13. Allowed and forbidden retained data。
14. Acceptance contact and test data window。

## Acceptance Standard

Connection:

- Authentication PASS。
- Permission scope PASS。
- Base URL and network PASS。

Read:

- Pagination PASS。
- Incremental cursor PASS。
- Timestamp semantics PASS。
- Retry / timeout PASS。
- Rate-limit behavior PASS。

Data:

- Field mapping PASS。
- External unique key PASS。
- Idempotent replay PASS。
- Tenant isolation PASS。
- Secret handling PASS。
- Raw record traceability PASS。
- Evidence locator PASS。

Business chain:

- Deterministic Rule produces expected Exception。
- Human can inspect Evidence and provenance。
- Governance can proceed without modifying external systems。

If any required item is `FAIL` or `BLOCKED`，the connector remains `NOT_VERIFIED`.

## Risks

- No stable cursor may force a limited full-scan strategy；this must be explicit。
- Vendor timezone and update-time semantics may differ from `observedAt`。
- Duplicate or revised external records may require a version policy。
- Rate limit and pagination behavior may vary by environment。
- Secret rotation may invalidate a long-running sync。
- Customer data retention may conflict with locator / raw-hash retention。
- No formal mapping registry yet；a minimal versioned mapping contract is required。
- Current inbound envelope lacks explicit installation / tenant binding and must not be guessed。

## Likely Code Change Areas

Planning only；no implementation is authorized in this phase.

- `src/connectors/core/types.ts`：read-only connector and sync-run contracts。
- New read connector worker module：pagination、cursor、retry and run state。
- New migration：sync state、mapping version and per-run counters。
- Existing V2 store：tenant-scoped sync state persistence。
- Existing Entity / Event / Evidence repository：canonical commit boundary。
- Existing Rule Engine：no connector-specific rule logic。

Do not put business rules into the connector.

## Explicit Non-goals

- No speculative vendor Connector。
- No external write operations。
- No production ERP / MES / QMS / WMS claim。
- No full historical backfill by default。
- No new AI provider。
- No new Solution Pack。
- No UI redesign。
- No change to Policy、Approval or Automation authority。

## Exit Criteria

The first real Pilot can move from `DEMO_VERIFIED` only when:

- Real sandbox credentials are issued。
- Real records are read through the Connector。
- Records are mapped with a versioned mapping。
- Evidence retains source provenance。
- Deterministic Rules produce traceable Exceptions。
- Acceptance contract has no `FAIL` or `BLOCKED`。
- The final state is explicitly `REAL_EXTERNAL_RUNTIME_VERIFIED`，not inferred from local tests。
