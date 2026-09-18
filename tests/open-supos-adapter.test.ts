import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { V2SqliteStore } from "../src/domain/v2/index.js";
import {
  InMemoryUnsTransport,
  OpenSupOSAdapter,
  OpenSupOSIntegrationError,
  OpenSupOSMqttTransport,
  applyDomainWritePlan,
  buildUnsTopic,
  mapUnsEnvelopeToDomainPlan,
  parseOpenSupOSUnsEnvelope,
  parseUnsTopic,
  startOpenSupOSInbound,
  type OpenSupOSUnsEnvelope,
} from "../src/integrations/open-supos/index.js";

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
  const dir = mkdtempSync(join(tmpdir(), "fep-uns-"));
  const db = new sqlite!.DatabaseSync(join(dir, "uns.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function envelope(): OpenSupOSUnsEnvelope {
  return {
    schemaVersion: "1.0",
    messageId: "MES-DEMO:MO-MFG-001:v1:completed",
    tenantKey: "demo-manufacturing",
    context: { businessKey: "SO-MFG-001", contextType: "sales_order" },
    source: {
      systemKey: "MES-DEMO",
      systemType: "mes",
      externalDocumentId: "MO-MFG-001",
      documentType: "production_order",
      sourceVersion: "v1",
    },
    entity: { entityType: "production_order", businessKey: "MO-MFG-001" },
    event: { eventType: "PRODUCTION_COMPLETED", occurredAt: "2026-09-08T00:00:00.000Z" },
    facts: {
      completedQty: { value: 100, valueType: "number" },
      lotCount: { value: 5, valueType: "number" },
    },
    lineage: { quote: "completedQty=100", confidence: 1 },
    metadata: { recordedAt: "2026-09-08T01:00:00.000Z" },
  };
}

describe("Open supOS integration boundary", () => {
  it("parses only supported Envelope versions and known types", () => {
    expect(parseOpenSupOSUnsEnvelope(envelope()).messageId).toBe("MES-DEMO:MO-MFG-001:v1:completed");
    expect(() => parseOpenSupOSUnsEnvelope({ ...envelope(), schemaVersion: "2.0" }))
      .toThrow(/DOMAIN_UNS_SCHEMA_VERSION_UNSUPPORTED/);
    expect(() => parseOpenSupOSUnsEnvelope({
      ...envelope(),
      source: { ...envelope().source, systemType: "unknown" },
    })).toThrow(/UNSUPPORTED_SOURCE_SYSTEM_TYPE/);
  });

  it("round-trips safe UNS topics and rejects malformed segments", () => {
    const topic = buildUnsTopic(envelope());
    expect(topic).toBe("fulfillment/demo-manufacturing/SO-MFG-001/production_order/MO-MFG-001/PRODUCTION_COMPLETED");
    expect(parseUnsTopic(topic)).toMatchObject({
      tenantKey: "demo-manufacturing",
      contextBusinessKey: "SO-MFG-001",
      entityType: "production_order",
      entityBusinessKey: "MO-MFG-001",
      eventType: "PRODUCTION_COMPLETED",
    });
    const escaped = buildUnsTopic({
      ...envelope(),
      context: { ...envelope().context, businessKey: "SO / MFG #1 +" },
      entity: { ...envelope().entity, businessKey: "MO + / #" },
    });
    expect(parseUnsTopic(escaped).contextBusinessKey).toBe("SO / MFG #1 +");
    expect(() => parseUnsTopic("fulfillment/a//entity/key/EVENT")).toThrow(/INVALID_UNS_TOPIC/);
  });

  it("creates a deterministic DomainWritePlan with one Evidence per fact", () => {
    const first = mapUnsEnvelopeToDomainPlan(parseOpenSupOSUnsEnvelope(envelope()));
    const second = mapUnsEnvelopeToDomainPlan(parseOpenSupOSUnsEnvelope(envelope()));
    expect(first.context.id).toBe(second.context.id);
    expect(first.businessEntity.id).toBe(second.businessEntity.id);
    expect(first.event.id).toBe(second.event.id);
    expect(first.evidence.map((item) => item.id)).toEqual(second.evidence.map((item) => item.id));
    expect(first.evidence).toHaveLength(2);
    expect(first.event.idempotencyKey).toBe("uns:MES-DEMO:MO-MFG-001:v1:completed");
  });

  it("ingests a message idempotently while preserving lineage", () => {
    const store = openStore();
    const adapter = new OpenSupOSAdapter(store);
    const topic = buildUnsTopic(envelope());
    const first = adapter.ingest(topic, JSON.stringify(envelope()));
    const second = adapter.ingest(topic, JSON.stringify(envelope()));
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(second.evidenceIds).toEqual(first.evidenceIds);
    const replay = store.replayContext("demo-manufacturing", first.contextId);
    expect(replay.events).toHaveLength(1);
    expect(replay.evidence).toHaveLength(2);
  });

  it("rolls back a partially invalid plan", () => {
    const store = openStore();
    const plan = mapUnsEnvelopeToDomainPlan(parseOpenSupOSUnsEnvelope(envelope()));
    plan.evidence[0]!.sourceDocumentId = "missing-document";
    expect(() => applyDomainWritePlan(store, plan)).toThrow();
    const replay = store.replayContext("demo-manufacturing", plan.context.id);
    expect(replay.context).toBeUndefined();
    expect(replay.events).toHaveLength(0);
    expect(replay.documents).toHaveLength(0);
  });

  it("supports an in-memory transport and requires MQTT configuration", async () => {
    const store = openStore();
    const adapter = new OpenSupOSAdapter(store);
    const transport = new InMemoryUnsTransport();
    await transport.connect();
    await startOpenSupOSInbound(adapter, transport);
    await transport.publish(buildUnsTopic(envelope()), JSON.stringify(envelope()));
    expect(store.replayContext("demo-manufacturing", mapUnsEnvelopeToDomainPlan(envelope()).context.id).events).toHaveLength(1);

    const mqtt = new OpenSupOSMqttTransport();
    await expect(mqtt.connect()).rejects.toMatchObject({ code: "UNS_TRANSPORT_NOT_CONFIGURED" });
    expect(new OpenSupOSIntegrationError("INVALID_UNS_TOPIC").code).toBe("INVALID_UNS_TOPIC");
  });
});
