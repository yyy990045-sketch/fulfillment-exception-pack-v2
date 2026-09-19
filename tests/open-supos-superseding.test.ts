import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  V2SqliteStore,
  acceptExceptionForResolution,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";
import {
  InMemoryUnsTransport,
  OpenSupOSAdapter,
  buildSoMfg001UnsMessages,
  mapExceptionToUnsMessage,
  mapResolutionCaseToUnsMessage,
  startConfiguredOpenSupOSInbound,
  type OpenSupOSUnsEnvelope,
} from "../src/integrations/open-supos/index.js";
import { resolutionActor } from "./helpers/resolution-actors.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-uns-roundtrip-"));
  const db = new sqlite!.DatabaseSync(join(dir, "roundtrip.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function ingestManifest(adapter: OpenSupOSAdapter) {
  return buildSoMfg001UnsMessages().map((message) => adapter.ingest(message.topic, message.envelope));
}

describe("Open supOS final seal", () => {
  it("rebuilds SO-MFG-001 from 11 UNS messages without fixture seeding", () => {
    const store = openStore();
    const adapter = new OpenSupOSAdapter(store);
    const messages = buildSoMfg001UnsMessages();
    expect(messages).toHaveLength(11);
    expect(new Set(messages.map((item) => item.envelope.source.externalDocumentId)).size).toBe(8);
    const results = ingestManifest(adapter);
    const contextId = results[0]!.contextId;
    const replay = store.replayContext("demo-manufacturing", contextId);

    expect(replay.context).toBeDefined();
    expect(replay.sourceSystems).toHaveLength(7);
    expect(replay.entities).toHaveLength(8);
    expect(replay.entityReferences).toHaveLength(8);
    expect(replay.documents).toHaveLength(8);
    expect(replay.events).toHaveLength(11);
    expect(replay.evidence).toHaveLength(11);

    const evidenceFor = (entityType: string, field: string) => {
      const entityIds = new Set(replay.entities.filter((entity) => entity.entityType === entityType).map((entity) => entity.id));
      return replay.evidence.find((item) => item.entityId && entityIds.has(item.entityId) && item.field === field);
    };
    expect(evidenceFor("quote", "qty")?.value).toBe(100);
    expect(evidenceFor("sales_order", "qty")?.value).toBe(100);
    expect(evidenceFor("production_order", "plannedQty")?.value).toBe(100);
    expect(evidenceFor("production_order", "completedQty")?.value).toBe(100);
    expect(evidenceFor("quality_event", "inspectedQty")?.value).toBe(100);
    expect(evidenceFor("quality_event", "passedQty")?.value).toBe(96);
    expect(evidenceFor("quality_event", "failedQty")?.value).toBe(4);
    expect(evidenceFor("shipment", "qty")?.value).toBe(96);
    expect(evidenceFor("receivable", "amount")?.value).toBe(100000);
    expect(evidenceFor("payment", "amount")?.value).toBe(80000);
    expect(evidenceFor("complaint", "claimedReceivedQty")?.value).toBe(80);

    const completed = replay.evidence.find((item) => item.field === "completedQty")!;
    expect(completed).toMatchObject({
      sourceSystemId: "MES-DEMO",
      sourceDocumentId: expect.any(String),
      entityId: expect.any(String),
      eventId: expect.any(String),
    });
    const passed = replay.evidence.find((item) => item.field === "passedQty")!;
    const failed = replay.evidence.find((item) => item.field === "failedQty")!;
    expect(passed.sourceSystemId).toBe("QMS-DEMO");
    expect(failed.sourceSystemId).toBe("QMS-DEMO");
    expect(passed.eventId).not.toBe(failed.eventId);
  });

  it("keeps duplicate batches idempotent and rejects divergent payloads", () => {
    const store = openStore();
    const adapter = new OpenSupOSAdapter(store);
    ingestManifest(adapter);
    const duplicateResults = ingestManifest(adapter);
    expect(duplicateResults.every((result) => result.duplicated)).toBe(true);
    const contextId = duplicateResults[0]!.contextId;
    const replay = store.replayContext("demo-manufacturing", contextId);
    expect(replay.documents).toHaveLength(8);
    expect(replay.events).toHaveLength(11);
    expect(replay.evidence).toHaveLength(11);

    const conflict = buildSoMfg001UnsMessages()[3]!;
    const divergent: OpenSupOSUnsEnvelope = {
      ...conflict.envelope,
      facts: { completedQty: { value: 98, valueType: "number" } },
    };
    expect(() => adapter.ingest(conflict.topic, divergent)).toThrow(/IDEMPOTENCY_CONFLICT/);
  });

  it("allows an explicit v2 source document and event without deleting v1", () => {
    const store = openStore();
    const adapter = new OpenSupOSAdapter(store);
    ingestManifest(adapter);
    const passed = buildSoMfg001UnsMessages()[5]!;
    const v2: OpenSupOSUnsEnvelope = {
      ...passed.envelope,
      messageId: "QMS-DEMO:QC-MFG-001:v2:passed",
      source: { ...passed.envelope.source, sourceVersion: "v2" },
      event: { ...passed.envelope.event, occurredAt: "2026-09-19T12:00:00.000Z" },
      facts: { passedQty: { value: 95, valueType: "number" } },
      metadata: { recordedAt: "2026-09-19T13:00:00.000Z" },
    };
    adapter.ingest(passed.topic, v2);
    const contextId = new OpenSupOSAdapter(store).ingest(buildSoMfg001UnsMessages()[0]!.topic, buildSoMfg001UnsMessages()[0]!.envelope).contextId;
    const full = store.replayContext("demo-manufacturing", contextId);
    const qmsDocs = full.documents.filter((item) => item.externalDocumentId === "QC-MFG-001");
    const passedEvidence = full.evidence.filter((item) => item.field === "passedQty");
    expect(qmsDocs.map((item) => item.version).sort()).toEqual(["v1", "v2"]);
    expect(passedEvidence.map((item) => item.value).sort()).toEqual([95, 96]);
  });

  it("keeps configured MQTT runtime disabled unless explicitly enabled", async () => {
    const store = openStore();
    const adapter = new OpenSupOSAdapter(store);
    let factoryCalls = 0;
    const disabled = await startConfiguredOpenSupOSInbound(adapter, {
      env: { OPEN_SUPOS_ENABLED: "false" },
      transportFactory: () => { factoryCalls += 1; return new InMemoryUnsTransport(); },
    });
    expect(disabled).toEqual({ status: "disabled" });
    expect(factoryCalls).toBe(0);

    const transport = new InMemoryUnsTransport();
    const enabled = await startConfiguredOpenSupOSInbound(adapter, {
      env: { OPEN_SUPOS_ENABLED: "true" },
      transportFactory: () => transport,
    });
    expect(enabled.status).toBe("started");
  });

  it("maps exception and resolution status messages without publishing", () => {
    const store = openStore();
    provisionV2ManufacturingDemoData(store);
    const evaluated = evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001")!;
    const exception = evaluated.exceptions.find((item) => item.code === "QUALITY_NONCONFORMING_QUANTITY_DETECTED")!;
    const exceptionMessage = mapExceptionToUnsMessage(exception, "SO-MFG-001");
    expect(exceptionMessage.topic).toContain("/exceptions/QUALITY_NONCONFORMING_QUANTITY_DETECTED/");
    expect(exceptionMessage.payload).toMatchObject({
      messageType: "exception",
      code: "QUALITY_NONCONFORMING_QUANTITY_DETECTED",
      status: "detected",
      severity: "medium",
    });
    expect(exceptionMessage.payload).not.toHaveProperty("evidenceBundle");

    const resolution = acceptExceptionForResolution(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id, {
      ownerRole: "品质负责人",
      rationale: "进入处置",
      actor: resolutionActor("制造经理", ["品质负责人"], "subject-manufacturing-manager"),
    });
    const resolutionMessage = mapResolutionCaseToUnsMessage(resolution, "SO-MFG-001", false);
    expect(resolutionMessage.topic).toContain("/resolution/");
    expect(resolutionMessage.payload).toMatchObject({
      messageType: "resolution_case",
      status: "triaged",
      sourceChanged: false,
    });
    expect(resolutionMessage.payload).not.toHaveProperty("runtime");
    expect(resolutionMessage.payload).not.toHaveProperty("receipts");
  });
});
