import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorError,
  ReferenceFulfillmentSourceAdapter,
  ReferenceInboundHttpConnector,
  canAdvanceInboundCursor,
  installConnector,
  runInboundSync,
} from "../src/connectors/index.js";
import {
  V2SqliteStore,
  createFulfillmentContext,
  evaluateContextRules,
} from "../src/domain/v2/index.js";
import { bindPackContext, manufacturingFulfillmentPack, registerBuiltInSolutionPacks } from "../src/solution-packs/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];
const servers: Server[] = [];

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-inbound-"));
  const db = new sqlite!.DatabaseSync(join(dir, "inbound.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  registerBuiltInSolutionPacks();
  manufacturingFulfillmentPack.install(store, "tenant-a", "installer", { ruleProfile: "manufacturing" });
  store.saveContext(createFulfillmentContext({
    id: "ctx-inbound-001",
    tenantId: "tenant-a",
    businessKey: "SO-INBOUND-001",
    contextType: "sales_order",
    status: "active",
    openedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    metadata: { ruleProfile: "manufacturing" },
  }));
  bindPackContext(store, manufacturingFulfillmentPack, "tenant-a", "ctx-inbound-001", "installer");
  return store;
}

async function startServer(handler: (request: any, response: any) => Promise<void> | void) {
  const server = createServer(async (request, response) => handler(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server_address_missing");
  return `http://127.0.0.1:${address.port}`;
}

function json(response: any, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function referenceRecord(input: {
  externalRecordId: string;
  entityType: string;
  businessKey: string;
  field?: string;
  value?: unknown;
  sourceVersion?: string;
  valueType?: string;
}) {
  return {
    externalRecordId: input.externalRecordId,
    recordType: "REFERENCE.FULFILLMENT",
    occurredAt: "2026-09-19T10:00:00.000Z",
    observedAt: "2026-09-19T10:01:00.000Z",
    sourceVersion: input.sourceVersion ?? "v1",
    locator: { collection: "reference", row: input.externalRecordId },
    payload: {
      contextId: "ctx-inbound-001",
      entityType: input.entityType,
      businessKey: input.businessKey,
      field: input.field ?? "qty",
      value: input.value ?? 100,
      valueType: input.valueType ?? "number",
      sourceSystemId: "reference-source",
      sourceSystemName: "Reference Source",
    },
  };
}

async function installReferenceInbound(store: V2SqliteStore, baseUrl: string, timeoutMs = 500) {
  return installConnector(store, new ReferenceInboundHttpConnector(), {
    tenantId: "tenant-a",
    installationId: "inbound-installation-a",
    config: { baseUrl, timeoutMs },
    actor: "connector-owner",
  });
}

function saveMapping(store: V2SqliteStore, version: string) {
  return store.saveConnectorMappingVersion({
    tenantId: "tenant-a",
    connectorId: "reference-inbound-http",
    mappingId: "reference-fulfillment",
    version,
    effectiveAt: "2026-09-01T00:00:00.000Z",
    definitionHash: createHash("sha256").update(version).digest("hex"),
    description: `Reference mapping ${version}`,
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

async function runSync(store: V2SqliteStore, options: Partial<Parameters<typeof runInboundSync>[2]> = {}) {
  return runInboundSync(store, new ReferenceInboundHttpConnector(), {
    tenantId: "tenant-a",
    connectorInstallationId: "inbound-installation-a",
    recordType: "REFERENCE.FULFILLMENT",
    mappingId: "reference-fulfillment",
    mappingVersion: "v1",
    adapter: new ReferenceFulfillmentSourceAdapter(),
    pageSize: 2,
    maxPages: 5,
    maxRecords: 20,
    afterPageCommit: ({ contextIds }) => {
      for (const contextId of contextIds) evaluateContextRules(store, "tenant-a", contextId);
    },
    ...options,
  });
}

function pageA() {
  return referenceRecord({ externalRecordId: "external-quote-1", entityType: "quote", businessKey: "QT-INBOUND-001", value: 100 });
}

function pageB() {
  return referenceRecord({ externalRecordId: "external-order-1", entityType: "sales_order", businessKey: "SO-INBOUND-001", value: 80 });
}

function pageC() {
  return referenceRecord({ externalRecordId: "external-quote-2", entityType: "quote", businessKey: "QT-INBOUND-001", value: 100 });
}

function expectCursorInvariant(result: Awaited<ReturnType<typeof runSync>>) {
  expect(result.run.committedCursor).toBe(result.state.lastSuccessfulCursor);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const db of databases.splice(0)) db.close();
});

describe("Inbound Connector Runtime", () => {
  it("defines a fail-closed safe cursor invariant", () => {
    expect(canAdvanceInboundCursor({ recordsRejected: 0, downstreamPending: 0 })).toBe(true);
    expect(canAdvanceInboundCursor({ recordsRejected: 1, downstreamPending: 0 })).toBe(false);
    expect(canAdvanceInboundCursor({ recordsRejected: 0, downstreamPending: 1 })).toBe(false);
  });

  it("keeps run and state cursors equal on single-page success", async () => {
    const baseUrl = await startServer((_request, response) => {
      json(response, 200, { records: [pageA(), pageB()], nextCursor: "single-end", hasMore: false });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");

    const result = await runSync(store, { runId: "single-page" });
    expectCursorInvariant(result);
    expect(result.run).toMatchObject({ status: "succeeded", committedCursor: "single-end" });
    expect(result.state.lastSuccessfulCursor).toBe("single-end");
  });

  it("fails closed when downstream ledger marking leaves pending records", async () => {
    const baseUrl = await startServer((_request, response) => {
      json(response, 200, { records: [pageA(), pageB()], nextCursor: "pending", hasMore: false });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");
    const markSpy = vi.spyOn(store, "markConnectorSourceRecordsDownstreamProcessed")
      .mockImplementation(() => undefined);

    const result = await runSync(store, { runId: "pending-downstream" });
    expectCursorInvariant(result);
    expect(result.run).toMatchObject({
      status: "blocked",
      lastErrorCode: "DOWNSTREAM_PROCESSING_INCOMPLETE",
      committedCursor: null,
    });
    expect(result.state.lastSuccessfulCursor).toBeNull();
    const ledgerIds = store.listConnectorSourceRecords("tenant-a", "inbound-installation-a").map((item) => item.id);
    expect(store.countPendingConnectorSourceRecords("tenant-a", ledgerIds)).toBe(2);
    markSpy.mockRestore();
  });

  it("reads multiple pages, persists cursor, commits Evidence, and runs rules", async () => {
    const baseUrl = await startServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      const cursor = url.searchParams.get("cursor");
      if (!cursor) return json(response, 200, { records: [pageA(), pageB()], nextCursor: "2", hasMore: true, providerRequestId: "page-1" });
      if (cursor === "2") return json(response, 200, { records: [pageC()], nextCursor: "3", hasMore: false, providerRequestId: "page-2" });
      return json(response, 200, { records: [], nextCursor: cursor, hasMore: false });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");

    const result = await runSync(store);
    expectCursorInvariant(result);
    expect(result.run).toMatchObject({ status: "succeeded", recordsRead: 3, recordsCommitted: 3, recordsAccepted: 3, recordsRejected: 0, recordsDuplicate: 0 });
    expect(result.state.lastSuccessfulCursor).toBe("3");
    expect(store.listConnectorSourceRecords("tenant-a", "inbound-installation-a")).toHaveLength(3);
    const exception = store.listExceptions("tenant-a", "ctx-inbound-001").find((item) => item.code === "QUOTE_ORDER_QUANTITY_MISMATCH");
    expect(exception).toBeDefined();
    const bundle = store.getExceptionEvidenceBundle("tenant-a", exception!.id)!;
    const quantityEvidence = bundle.evidence.find((item) => item.field === "qty")!;
    expect(quantityEvidence.metadata).toMatchObject({
      connectorId: "reference-inbound-http",
      mappingId: "reference-fulfillment",
      mappingVersion: "v1",
    });
    const ledger = store.listConnectorSourceRecords("tenant-a", "inbound-installation-a")
      .find((item) => item.evidenceRefs.includes(quantityEvidence.evidenceId));
    expect(ledger).toBeDefined();
  });

  it("does not duplicate page-one Evidence when page two crashes and is replayed", async () => {
    const baseUrl = await startServer((request, response) => {
      const cursor = new URL(request.url, "http://localhost").searchParams.get("cursor");
      if (!cursor) return json(response, 200, { records: [pageA(), pageB()], nextCursor: "2", hasMore: true });
      return json(response, 200, { records: [pageC()], nextCursor: "3", hasMore: false });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");

    const failed = await runSync(store, {
      runId: "run-crash",
      afterPageCommit: () => {
        throw new ConnectorError("CANONICAL_COMMIT_FAILED", 500, { retryable: true });
      },
    });
    expect(failed.run).toMatchObject({
      status: "failed",
      recordsRead: 2,
      recordsCommitted: 2,
      recordsAccepted: 2,
      recordsRejected: 0,
      recordsDuplicate: 0,
    });
    expectCursorInvariant(failed);
    expect(failed.state.lastSuccessfulCursor).toBeNull();
    const failedLedger = store.listConnectorSourceRecords("tenant-a", "inbound-installation-a");
    expect(failedLedger).toHaveLength(2);
    expect(failedLedger.every((item) => item.canonicalCommittedAt && !item.downstreamProcessedAt)).toBe(true);
    expect(store.listExceptions("tenant-a", "ctx-inbound-001")).toHaveLength(0);

    const replay = await runSync(store, { runId: "run-replay" });
    expectCursorInvariant(replay);
    expect(replay.run).toMatchObject({ status: "succeeded", recordsDuplicate: 2, recordsCommitted: 1, recordsAccepted: 1 });
    expect(replay.state.lastSuccessfulCursor).toBe("3");
    const replayLedger = store.listConnectorSourceRecords("tenant-a", "inbound-installation-a");
    expect(replayLedger).toHaveLength(3);
    expect(replayLedger.every((item) => item.downstreamProcessedAt)).toBe(true);
    expect(store.listExceptions("tenant-a", "ctx-inbound-001").some((item) => item.code === "QUOTE_ORDER_QUANTITY_MISMATCH")).toBe(true);
  });

  it("blocks cursor advancement on a rejected record and backfills it on replay", async () => {
    let invalid = true;
    const baseUrl = await startServer((_request, response) => {
      const bad = referenceRecord({ externalRecordId: "external-order-1", entityType: "sales_order", businessKey: "SO-INBOUND-001", value: 80 });
      if (invalid) {
        (bad.payload as Record<string, unknown>).valueType = undefined;
      }
      json(response, 200, {
        records: [pageA(), bad, pageC()],
        nextCursor: "rejected-page",
        hasMore: false,
      });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");

    const blocked = await runSync(store, { runId: "rejected-first" });
    expectCursorInvariant(blocked);
    expect(blocked.run).toMatchObject({
      status: "failed",
      lastErrorCode: "RECORD_REJECTED",
      recordsRead: 3,
      recordsCommitted: 2,
      recordsAccepted: 2,
      recordsRejected: 1,
      recordsDuplicate: 0,
      attemptedCursor: "rejected-page",
    });
    expect(blocked.state.lastSuccessfulCursor).toBeNull();
    expect(blocked.state.lastAttemptedCursor).toBe("rejected-page");
    const blockedLedger = store.listConnectorSourceRecords("tenant-a", "inbound-installation-a");
    expect(blockedLedger).toHaveLength(2);
    expect(blockedLedger.every((item) => !item.downstreamProcessedAt)).toBe(true);
    expect(store.listEvidence("tenant-a", "ctx-inbound-001").filter((item) => item.field === "qty")).toHaveLength(2);
    expect(store.listExceptions("tenant-a", "ctx-inbound-001")).toHaveLength(0);

    invalid = false;
    const replay = await runSync(store, { runId: "rejected-replay" });
    expectCursorInvariant(replay);
    expect(replay.run).toMatchObject({
      status: "succeeded",
      recordsRead: 3,
      recordsCommitted: 1,
      recordsAccepted: 1,
      recordsRejected: 0,
      recordsDuplicate: 2,
    });
    expect(replay.state.lastSuccessfulCursor).toBe("rejected-page");
    const replayLedger = store.listConnectorSourceRecords("tenant-a", "inbound-installation-a");
    expect(replayLedger).toHaveLength(3);
    expect(replayLedger.every((item) => item.downstreamProcessedAt)).toBe(true);
    expect(store.listEvidence("tenant-a", "ctx-inbound-001").filter((item) => item.field === "qty")).toHaveLength(3);
    expect(store.listExceptions("tenant-a", "ctx-inbound-001").some((item) => item.code === "QUOTE_ORDER_QUANTITY_MISMATCH")).toBe(true);
  });

  it("keeps the successful cursor unchanged on rate limit", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(429, { "content-type": "application/json", "retry-after": "2" });
      response.end(JSON.stringify({ error: "rate_limited" }));
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");

    const result = await runSync(store);
    expectCursorInvariant(result);
    expect(result.run).toMatchObject({
      status: "failed",
      lastErrorCode: "RATE_LIMITED",
      errorClass: "retryable",
      retryAfterMs: 2_000,
    });
    expect(result.state.lastSuccessfulCursor).toBeNull();
    expect(result.state.lastAttemptedCursor).toBeNull();
  });

  it("blocks invalid provider responses without advancing the cursor", async () => {
    const baseUrl = await startServer((_request, response) => {
      json(response, 200, { records: [{ externalRecordId: "bad-record" }], nextCursor: null, hasMore: false });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");

    const result = await runSync(store);
    expectCursorInvariant(result);
    expect(result.run).toMatchObject({ status: "blocked", lastErrorCode: "INVALID_RESPONSE", errorClass: "blocked" });
    expect(result.state.lastSuccessfulCursor).toBeNull();
  });

  it("classifies provider timeout as retryable without advancing cursor", async () => {
    const baseUrl = await startServer(() => new Promise(() => {}));
    const store = openStore();
    await installReferenceInbound(store, baseUrl, 150);
    saveMapping(store, "v1");

    const result = await runSync(store);
    expectCursorInvariant(result);
    expect(result.run).toMatchObject({
      status: "failed",
      lastErrorCode: "TIMEOUT",
      errorClass: "retryable",
    });
    expect(result.state.lastSuccessfulCursor).toBeNull();
  });

  it("records a source revision as new Evidence without deleting old provenance", async () => {
    let version = "v1";
    let value = 100;
    const baseUrl = await startServer((_request, response) => {
      json(response, 200, {
        records: [referenceRecord({ externalRecordId: "external-quote-1", entityType: "quote", businessKey: "QT-INBOUND-001", value, sourceVersion: version })],
        nextCursor: version,
        hasMore: false,
      });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");
    await runSync(store, { runId: "revision-v1" });
    version = "v2";
    value = 110;
    await runSync(store, { runId: "revision-v2" });

    const ledger = store.listConnectorSourceRecords("tenant-a", "inbound-installation-a");
    expect(ledger).toHaveLength(2);
    expect(ledger.map((item) => item.sourceVersion)).toEqual(["v1", "v2"]);
    expect(store.listEvidence("tenant-a", "ctx-inbound-001").filter((item) => item.field === "qty")).toHaveLength(2);
  });

  it("keeps historical Evidence on the old mapping version after mapping changes", async () => {
    const baseUrl = await startServer((_request, response) => {
      json(response, 200, { records: [pageA()], nextCursor: "mapping", hasMore: false });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");
    await runSync(store, { runId: "mapping-v1" });
    saveMapping(store, "v2");
    await runSync(store, { runId: "mapping-v2", mappingVersion: "v2" });

    const evidence = store.listEvidence("tenant-a", "ctx-inbound-001").filter((item) => item.field === "qty");
    expect(evidence.map((item) => item.metadata.mappingVersion).sort()).toEqual(["v1", "v2"]);
    expect(store.listConnectorSourceRecords("tenant-a", "inbound-installation-a")).toHaveLength(2);
  });

  it("does not advance the cursor when canonical commit fails", async () => {
    const baseUrl = await startServer((_request, response) => {
      json(response, 200, { records: [pageA()], nextCursor: "1", hasMore: false });
    });
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");

    const result = await runSync(store, {
      runId: "commit-fail",
      adapter: {
        adapt: () => ({
          contextId: "ctx-missing",
          sourceSystems: [],
          sourceDocuments: [],
          entities: [{
            id: "missing-entity",
            tenantId: "tenant-a",
            contextId: "ctx-missing",
            entityType: "quote",
            businessKey: "MISSING-001",
            attributes: { qty: 1 },
            createdAt: "2026-09-19T10:01:00.000Z",
            updatedAt: "2026-09-19T10:01:00.000Z",
          }],
          events: [],
          evidence: [],
        }),
      },
    });
    expect(result.run).toMatchObject({ status: "failed", lastErrorCode: "CANONICAL_COMMIT_FAILED" });
    expect(result.state.lastSuccessfulCursor).toBeNull();
    expect(store.listConnectorSourceRecords("tenant-a", "inbound-installation-a")).toHaveLength(0);
  });

  it("fails closed for a cross-tenant installation", async () => {
    const baseUrl = await startServer((_request, response) => json(response, 200, { records: [], nextCursor: null, hasMore: false }));
    const store = openStore();
    await installReferenceInbound(store, baseUrl);
    saveMapping(store, "v1");
    await expect(runSync(store, { tenantId: "tenant-b" })).rejects.toMatchObject({ code: "CONNECTOR_NOT_FOUND" });
  });
});
