import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V2SqliteStore, type SqliteDatabaseLike } from "../src/domain/v2/index.js";
import { INDUSTRIAL_MAPPING_MANIFEST } from "../src/industrial/mapping-manifest.js";
import { DEMO_MANUFACTURING_HIERARCHY } from "../src/industrial/hierarchy.js";
import {
  CANONICAL_INDUSTRIAL_EVENT_SCHEMA_VERSION,
  canonicalEventLedgerKey,
  joinCanonicalEventsWithLedger,
} from "../src/industrial/canonical-event.js";
import {
  IndustrialSimulatorAdapter,
  canonicalSourceFromEnvelope,
  runIndustrialSimulation,
} from "../src/simulator/manufacturing/runner.js";
import { buildSimulationMessageStream } from "../src/simulator/manufacturing/emitter.js";
import { LocalSimulatorTransport } from "../src/simulator/manufacturing/transport.js";
import { DEFAULT_SIMULATION_SEED, resolveScenario } from "../src/simulator/manufacturing/scenarios.js";
import { parseOpenSupOSUnsEnvelope } from "../src/integrations/open-supos/envelope.js";
import type { SourceRecordEnvelope } from "../src/connectors/core/types.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };
const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");

function openStore() {
  const directory = mkdtempSync(join(tmpdir(), "fep-canonical-event-"));
  const database = new builtin!.DatabaseSync!(join(directory, "canonical.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return new V2SqliteStore(database);
}

describe("Canonical Industrial Event", () => {
  it("字段齐备：工业空间 + 多系统来源 + 时间 + payload + mapping 版本 + provenance", async () => {
    const store = openStore();
    const run = await runIndustrialSimulation({
      store,
      scenario: resolveScenario("production-shortfall"),
      transport: new LocalSimulatorTransport(),
      seed: DEFAULT_SIMULATION_SEED,
      speed: 0,
    });
    const completed = run.canonicalEvents.find((item) => item.eventType === "PRODUCTION_COMPLETED")!;
    expect(completed.schemaVersion).toBe(CANONICAL_INDUSTRIAL_EVENT_SCHEMA_VERSION);
    expect(completed).toMatchObject({
      tenantId: "demo-manufacturing",
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "line-a",
      sourceSystem: "MES-DEMO",
      entityType: "production_order",
      entityId: "MO-IND-002",
      eventType: "PRODUCTION_COMPLETED",
      mappingVersion: "1.0.0",
      businessContextKey: "SO-IND-002",
    });
    expect(completed.payload).toEqual({ completedQty: 96 });
    expect(completed.unsTopic).toBe(
      "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/production/MO-IND-002/production.completed",
    );
    expect(completed.provenance.sourceSystemType).toBe("mes");
    expect(completed.provenance.connectorId).toBe("open-supos-uns-inbound");
    expect(completed.provenance.externalRecordId).toContain("MES-DEMO:MO-IND-002");
    expect(completed.provenance.fieldMapping).toEqual([
      { sourceField: "completed_qty", canonicalField: "completedQty", semanticField: "completedQuantity", unit: "pcs" },
    ]);
    expect(completed.rawHash).toHaveLength(64);
    // sourceLocator 是 Connector Core 的摄取位置（哪条 topic / 哪条外部记录），
    // 信封自身的 lineage 位置（fileName/row）落在 Evidence 上，二者刻意分开。
    expect(completed.sourceLocator).toMatchObject({
      topic: completed.unsTopic,
      namespace: "enterprise/demo-manufacturing",
      entityBusinessKey: "MO-IND-002",
      eventType: "PRODUCTION_COMPLETED",
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      lineId: "line-a",
      equipmentId: "machine-a01",
    });
    expect(completed.sourceRecordId).toMatch(/^source-/);
  });

  it("同一规范事件在不同库里 ID 稳定（可去重），且来源记录 ID 指向真实账本条目", async () => {
    const scenario = resolveScenario("normal");
    const storeA = openStore();
    const storeB = openStore();
    const first = await runIndustrialSimulation({ store: storeA, scenario, transport: new LocalSimulatorTransport(), speed: 0 });
    const second = await runIndustrialSimulation({ store: storeB, scenario, transport: new LocalSimulatorTransport(), speed: 0 });
    expect(first.canonicalEvents.map((item) => item.eventId)).toEqual(second.canonicalEvents.map((item) => item.eventId));
    expect(first.canonicalEvents.map((item) => item.rawHash)).toEqual(second.canonicalEvents.map((item) => item.rawHash));
    expect(first.canonicalEvents).toHaveLength(16);
    const ledgerIds = new Set(
      storeA.listConnectorSourceRecords("demo-manufacturing", "industrial-simulator-uns-installation").map((item) => item.id),
    );
    expect(ledgerIds.size).toBe(16);
    for (const event of first.canonicalEvents) expect(ledgerIds.has(event.sourceRecordId)).toBe(true);
  });

  it("Canonical Event 位于 SourceRecordEnvelope 与 Domain Event 之间：Envelope 契约未被改动", () => {
    const stream = buildSimulationMessageStream({
      scenario: resolveScenario("normal"),
      seed: DEFAULT_SIMULATION_SEED,
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      hierarchy: DEMO_MANUFACTURING_HIERARCHY,
    });
    const message = stream.messages[0]!;
    const envelope: SourceRecordEnvelope = {
      tenantId: "demo-manufacturing",
      connectorId: "open-supos-uns-inbound",
      connectorInstallationId: "install",
      externalRecordId: message.envelope.messageId,
      recordType: "OPEN_SUPOS.UNS.EVENT",
      occurredAt: message.envelope.event.occurredAt,
      observedAt: message.envelope.event.occurredAt,
      sourceVersion: "v1",
      locator: { topic: message.topic },
      rawHash: "0".repeat(64),
      mappingId: "industrial-mapping",
      mappingVersion: "1.0.0",
      payload: message.envelope as unknown as Record<string, unknown>,
    };
    const adapter = new IndustrialSimulatorAdapter(openStore(), INDUSTRIAL_MAPPING_MANIFEST, DEMO_MANUFACTURING_HIERARCHY);
    const adapted = adapter.adapt(envelope);
    // 领域写计划仍然来自既有适配器：Canonical Event 只是链路上多出的一层，不替换它
    expect(adapted.sourceSystems).toHaveLength(1);
    expect(adapted.entities).toHaveLength(1);
    expect(adapted.events).toHaveLength(1);
    expect(adapted.evidence).toHaveLength(1);
    expect(adapter.captured).toHaveLength(1);
    expect(adapter.captured[0]!.event.eventType).toBe("QUOTE_CREATED");
    expect(adapter.captured[0]!.ledgerKey).toBe(canonicalEventLedgerKey({
      externalRecordId: envelope.externalRecordId,
      sourceVersion: "v1",
      rawHash: envelope.rawHash,
      mappingId: "industrial-mapping",
      mappingVersion: "1.0.0",
    }));
  });

  it("没有账本记录的 Canonical Event 不允许自证成立（fail-closed）", () => {
    const store = openStore();
    expect(() => joinCanonicalEventsWithLedger({
      store,
      tenantId: "demo-manufacturing",
      connectorInstallationId: "missing-installation",
      recordType: "OPEN_SUPOS.UNS.EVENT",
      captured: [{
        event: {
          schemaVersion: CANONICAL_INDUSTRIAL_EVENT_SCHEMA_VERSION,
          eventId: "cie-orphan",
          tenantId: "demo-manufacturing",
          enterpriseId: "e", siteId: "s", areaId: "a", lineId: "l", equipmentId: null,
          sourceSystem: "MES-DEMO", sourceRecordId: "source-missing",
          entityType: "production_order", entityId: "MO-1", eventType: "PRODUCTION_COMPLETED",
          occurredAt: "2026-09-08T00:00:00.000Z", observedAt: "2026-09-08T00:05:00.000Z",
          payload: {}, mappingVersion: "1.0.0", sourceLocator: {}, rawHash: "x",
          unsTopic: "enterprise/e/site/s/area/a/line/l/production/MO-1/production.completed",
          businessContextKey: "SO-1",
          provenance: {
            connectorId: "open-supos-uns-inbound", connectorInstallationId: "missing-installation",
            externalRecordId: "x", recordType: "OPEN_SUPOS.UNS.EVENT", sourceVersion: "v1",
            sourceSystemType: "mes", fieldMapping: [],
          },
        },
        ledgerKey: "not-in-ledger",
      }],
    })).toThrow(/CANONICAL_EVENT_WITHOUT_LEDGER_RECORD/);
  });

  it("canonicalSourceFromEnvelope 只搬运事实，不发明字段", () => {
    const stream = buildSimulationMessageStream({
      scenario: resolveScenario("quality-failure"),
      seed: DEFAULT_SIMULATION_SEED,
      manifest: INDUSTRIAL_MAPPING_MANIFEST,
      hierarchy: DEMO_MANUFACTURING_HIERARCHY,
    });
    const failed = stream.messages.find((item) => item.envelope.event.eventType === "QUALITY_FAILED")!;
    const parsed = parseOpenSupOSUnsEnvelope(failed.envelope);
    const source = canonicalSourceFromEnvelope(parsed);
    expect(source.facts).toEqual({ failedQty: 6 });
    expect(source.entityType).toBe("quality_event");
    expect(source.sourceSystemType).toBe("qms");
    expect(source.sourceSystemKey).toBe("QMS-DEMO");
    expect(source.businessContextKey).toBe("SO-IND-003");
  });
});
