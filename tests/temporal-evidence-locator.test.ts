/**
 * Phase A1 — Temporal Evidence Locator Convergence
 *
 * 目标：让 v2 Evidence locator 能无损表达「时序位置」，同时保证既有文档型 locator 完全不受影响。
 *
 * 本文件**不**接入 ASR / Work 3200 / Root Cause / UI：
 * fixture 是本地手工构造的形状样本，明确标记 SIMULATED_ASR_FIXTURE / NOT_REAL_WORK3200 / NOT_REAL_HARDWARE。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DomainError,
  V2SqliteStore,
  assertEvidenceLocator,
  createBusinessEntity,
  createEvidence,
  createFulfillmentContext,
  createSourceDocument,
  createSourceSystem,
  evidenceLocatorKinds,
  runV2Migrations,
  type V2Evidence,
} from "../src/domain/v2/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const DatabaseSync = sqlite.DatabaseSync;

const workspaces: string[] = [];
const openDatabases: DatabaseSyncLike[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "fep-temporal-locator-"));
  workspaces.push(dir);
  return dir;
}

function openStore() {
  const dir = workspace();
  const dbPath = join(dir, "pack-cases.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  runV2Migrations(db);
  return { db, dbPath, store: new V2SqliteStore(db) };
}

const TENANT = "demo-manufacturing";
const NOW = "2026-09-20T10:00:00.000Z";

/** 最小合法证据信封；locator 由各用例注入。 */
function evidenceWith(locator: V2Evidence["locator"], overrides: Partial<V2Evidence> = {}): V2Evidence {
  return {
    id: "ev-1",
    tenantId: TENANT,
    contextId: "ctx-so-mfg-001",
    sourceSystemId: "sys-voice",
    sourceDocumentId: "doc-recording-001",
    sourceVersion: "v1",
    field: "utterance",
    value: "电机这里有周期性的摩擦声",
    valueType: "string",
    locator,
    quote: "电机这里有周期性的摩擦声",
    confidence: 0.9,
    support: "supported",
    observedAt: NOW,
    createdAt: NOW,
    metadata: {},
    ...overrides,
  };
}

function seedGraph(store: V2SqliteStore) {
  store.saveContext(createFulfillmentContext({
    id: "ctx-so-mfg-001",
    tenantId: TENANT,
    businessKey: "SO-MFG-001",
    contextType: "field_service",
    status: "active",
    openedAt: NOW,
    updatedAt: NOW,
    metadata: {},
  }));
  store.saveSourceSystem(createSourceSystem({
    id: "sys-voice",
    tenantId: TENANT,
    name: "现场录音",
    systemType: "file",
    authorityLevel: "contributing",
    status: "active",
    metadata: {},
  }));
  store.saveBusinessEntity(createBusinessEntity({
    id: "entity-device-3",
    tenantId: TENANT,
    contextId: "ctx-so-mfg-001",
    entityType: "device",
    businessKey: "DV-3",
    attributes: { model: "M-3200" },
    createdAt: NOW,
    updatedAt: NOW,
  }));
  store.saveSourceDocument(createSourceDocument({
    id: "doc-recording-001",
    tenantId: TENANT,
    sourceSystemId: "sys-voice",
    contextId: "ctx-so-mfg-001",
    entityId: "entity-device-3",
    externalDocumentId: "recording-20260920-1015",
    documentType: "audio_recording",
    contentHash: "a".repeat(64),
    receivedAt: NOW,
    effectiveAt: null,
    version: "v1",
    // 工件自身的名字与类型属于「哪个材料」，不属于「哪一段」：
    // 因此它在这里，而 temporal-only 的 locator 里没有 fileName。
    fileName: "recording-20260920-1015.wav",
    mimeType: "audio/wav",
    metadata: {},
  }));
}

// ---------------------------------------------------------------------------
// 16.1-16.3 三类 locator 都可以成立
// ---------------------------------------------------------------------------

describe("evidence locator convergence", () => {
  it("keeps a legacy document-only locator valid and reports the document kind", () => {
    const locator = { fileName: "ERP-SO-001.csv", row: 2, cell: "F2" };
    expect(() => createEvidence(evidenceWith(locator))).not.toThrow();
    expect(evidenceLocatorKinds(locator)).toEqual(["document"]);
    expect(assertEvidenceLocator(locator)).toEqual(["document"]);
  });

  it("accepts a temporal-only locator without inventing a fileName", () => {
    const locator = { startMs: 134300, endMs: 141850 };
    expect(() => createEvidence(evidenceWith(locator))).not.toThrow();
    expect(evidenceLocatorKinds(locator)).toEqual(["temporal"]);
    // 关键：没有伪造 fileName
    expect("fileName" in locator).toBe(false);
  });

  it("accepts a document + temporal locator together", () => {
    const locator = { fileName: "recording-20260920-1015.wav", startMs: 134300, endMs: 141850 };
    expect(() => createEvidence(evidenceWith(locator))).not.toThrow();
    expect(evidenceLocatorKinds(locator)).toEqual(["document", "temporal"]);
  });

  it("accepts a transcript span alongside the time span (audio segment = time + text)", () => {
    const locator = { startMs: 134300, endMs: 141850, startOffset: 0, endOffset: 13 };
    expect(assertEvidenceLocator(locator)).toEqual(["temporal", "transcript"]);
  });
});

// ---------------------------------------------------------------------------
// 16.4-16.5 区间不变量
// ---------------------------------------------------------------------------

describe("temporal locator invariants", () => {
  const rejected: Array<[string, V2Evidence["locator"], string]> = [
    ["startMs < 0", { startMs: -1, endMs: 10 }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID"],
    ["endMs <= startMs (equal)", { startMs: 500, endMs: 500 }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID"],
    ["endMs < startMs", { startMs: 500, endMs: 100 }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID"],
    ["NaN", { startMs: Number.NaN, endMs: 10 }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID"],
    ["Infinity", { startMs: 0, endMs: Number.POSITIVE_INFINITY }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID"],
    ["string masquerading as ms", { startMs: "134300" as unknown as number, endMs: "141850" as unknown as number }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID"],
    ["timestamp text masquerading as ms", { startMs: "02:14.300" as unknown as number, endMs: "02:21.850" as unknown as number }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID"],
    ["half-given span (startMs only)", { startMs: 10 }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INCOMPLETE"],
    ["half-given span (endMs only)", { endMs: 10 }, "DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INCOMPLETE"],
  ];

  for (const [label, locator, code] of rejected) {
    it(`rejects ${label} with ${code}`, () => {
      expect(() => createEvidence(evidenceWith(locator))).toThrowError(code);
    });
  }

  it("still rejects a locator with no position at all", () => {
    expect(() => createEvidence(evidenceWith({}))).toThrowError("DOMAIN_EVIDENCE_LOCATOR_REQUIRED");
  });

  it("rejects a blank fileName that carries no other position", () => {
    expect(() => createEvidence(evidenceWith({ fileName: "   " }))).toThrowError("DOMAIN_EVIDENCE_LOCATOR_REQUIRED");
  });

  it("rejects a non-string fileName", () => {
    expect(() => createEvidence(evidenceWith({ fileName: 42 as unknown as string }))).toThrowError("DOMAIN_EVIDENCE_LOCATOR_DOCUMENT_INVALID");
  });

  it("keeps the DomainError contract for locator failures", () => {
    try {
      createEvidence(evidenceWith({ startMs: 500, endMs: 500 }));
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("DOMAIN_EVIDENCE_LOCATOR_TEMPORAL_INVALID");
    }
  });
});

// ---------------------------------------------------------------------------
// 16.6-16.7 持久化往返 + 旧数据兼容
// ---------------------------------------------------------------------------

describe("temporal locator persistence", () => {
  it("round-trips a temporal locator through SQLite without loss or stringification", () => {
    const { db, dbPath, store } = openStore();
    seedGraph(store);
    const temporal = { startMs: 134300, endMs: 141850, startOffset: 0, endOffset: 13 };
    store.saveEvidence(evidenceWith(temporal));
    db.close();

    const reopened = new DatabaseSync(dbPath);
    openDatabases.push(reopened);
    const reloaded = new V2SqliteStore(reopened).getEvidence(TENANT, "ev-1");

    expect(reloaded?.locator).toEqual(temporal);
    expect(reloaded?.locator.startMs).toBe(134300);
    expect(reloaded?.locator.endMs).toBe(141850);
    // 明确断言没有被字符串化、也没有被塞进 fileName
    expect(typeof reloaded?.locator.startMs).toBe("number");
    expect(reloaded?.locator.fileName).toBeUndefined();
    // 重新校验仍然合法
    expect(() => createEvidence(reloaded!)).not.toThrow();
  });

  it("keeps legacy document-only rows readable and semantically unchanged", () => {
    const { db, dbPath, store } = openStore();
    seedGraph(store);
    store.saveEvidence(evidenceWith({ fileName: "ERP-SO-001.csv", row: 2, cell: "F2" }));
    db.close();

    const reopened = new DatabaseSync(dbPath);
    openDatabases.push(reopened);
    const reloaded = new V2SqliteStore(reopened).getEvidence(TENANT, "ev-1");

    expect(reloaded?.locator).toEqual({ fileName: "ERP-SO-001.csv", row: 2, cell: "F2" });
    expect(evidenceLocatorKinds(reloaded?.locator)).toEqual(["document"]);
  });

  it("reads a row written before this change (no temporal keys, fileName required shape)", () => {
    // 模拟旧版本写入的行：locator_json 里只有文档字段
    const { db, dbPath, store } = openStore();
    seedGraph(store);
    store.saveEvidence(evidenceWith({ fileName: "legacy.csv", line: 7 }));
    db.close();

    const raw = new DatabaseSync(dbPath);
    openDatabases.push(raw);
    const row = raw.prepare("SELECT locator_json FROM v2_evidence WHERE id = 'ev-1'").get() as { locator_json: string };
    expect(JSON.parse(row.locator_json)).toEqual({ fileName: "legacy.csv", line: 7 });
    expect(new V2SqliteStore(raw).getEvidence(TENANT, "ev-1")?.locator).toEqual({ fileName: "legacy.csv", line: 7 });
  });

  it("does not require a schema migration: locator_json already stores full JSON", () => {
    const { db } = openStore();
    const columns = db.prepare("PRAGMA table_info(v2_evidence)").all() as Array<{ name: string; type: string; notnull: number }>;
    const locator = columns.find((column) => column.name === "locator_json");
    expect(locator).toBeDefined();
    expect(locator!.type).toBe("TEXT");
    // TEXT + 应用层 JSON 序列化 → 新增 locator 字段无需改列
    expect(locator!.notnull).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 16.8 SIMULATED ASR FIXTURE → Evidence 端到端
// ---------------------------------------------------------------------------

describe("SIMULATED_ASR_FIXTURE → evidence round-trip", () => {
  /**
   * SIMULATED_ASR_FIXTURE — 本地手工构造的形状样本。
   * NOT_REAL_WORK3200 · NOT_REAL_HARDWARE · 不是 ASR 产物，也不是设备事件。
   * 它只证明：一段带时间范围的转写片段可以成为无损、可复核的 Evidence。
   */
  const SIMULATED_ASR_FIXTURE = {
    marker: "SIMULATED_ASR_FIXTURE",
    notRealHardware: true,
    artifact: {
      externalDocumentId: "recording-20260920-1015",
      contentHash: "a".repeat(64),
      mediaType: "audio/wav",
      version: "v1",
    },
    segment: {
      id: 4,
      startMs: 134300,
      endMs: 141850,
      text: "电机这里有周期性的摩擦声",
      startOffset: 0,
      endOffset: 13,
    },
  };

  it("carries artifact identity and the exact time range through persist → reload → validate", () => {
    const { db, dbPath, store } = openStore();
    seedGraph(store);

    const fixture = SIMULATED_ASR_FIXTURE;
    expect(fixture.marker).toBe("SIMULATED_ASR_FIXTURE");
    expect(fixture.notRealHardware).toBe(true);

    // fixture → Evidence（locator 只表达"哪一段"；工件身份来自 SourceDocument）
    const saved = store.saveEvidence(evidenceWith({
      startMs: fixture.segment.startMs,
      endMs: fixture.segment.endMs,
      startOffset: fixture.segment.startOffset,
      endOffset: fixture.segment.endOffset,
    }, {
      value: fixture.segment.text,
      quote: fixture.segment.text,
      metadata: { fixtureMarker: fixture.marker, segmentId: fixture.segment.id },
    }));

    db.close();
    const reopened = new DatabaseSync(dbPath);
    openDatabases.push(reopened);
    const reopenedStore = new V2SqliteStore(reopened);
    const reloaded = reopenedStore.getEvidence(TENANT, "ev-1")!;
    const artifact = reopenedStore.getSourceDocument(TENANT, "doc-recording-001")!;

    // 1. 时间范围不丢失、不字符串化
    expect(reloaded.locator.startMs).toBe(fixture.segment.startMs);
    expect(reloaded.locator.endMs).toBe(fixture.segment.endMs);
    expect(reloaded.locator.startMs).toBe(134300);
    expect(reloaded.locator.endMs).toBe(141850);

    // 2. 工件身份不变，且与位置严格分离
    expect(artifact.externalDocumentId).toBe(fixture.artifact.externalDocumentId);
    expect(artifact.contentHash).toBe(fixture.artifact.contentHash);
    expect(artifact.mimeType).toBe(fixture.artifact.mediaType);
    expect(reloaded.sourceDocumentId).toBe("doc-recording-001");
    expect(reloaded.sourceVersion).toBe(fixture.artifact.version);
    expect(reloaded.locator.fileName).toBeUndefined();

    // 3. 转写文本与 provenance 不变
    expect(reloaded.quote).toBe(fixture.segment.text);
    expect(reloaded.value).toBe(fixture.segment.text);
    expect(reloaded.metadata.fixtureMarker).toBe("SIMULATED_ASR_FIXTURE");
    expect(reloaded.sourceSystemId).toBe("sys-voice");
    expect(reloaded.observedAt).toBe(NOW);

    // 4. 重新校验仍然通过，且能被分类为时序证据
    expect(() => createEvidence(reloaded)).not.toThrow();
    expect(evidenceLocatorKinds(reloaded.locator)).toEqual(["temporal", "transcript"]);
    expect(saved.id).toBe("ev-1");
  });

  it("keeps an unsupported assertion honest: the mark/segment is not promoted to a fact", () => {
    const { db, store } = openStore();
    openDatabases.push(db);
    seedGraph(store);
    // 同一段时间片既可以是 supported，也可以是 unsupported —— 语义来自 support，不来自 locator
    store.saveEvidence(evidenceWith({ startMs: 134300, endMs: 141850 }, { support: "unsupported", value: "疑似轴承磨损" }));
    const reloaded = store.getEvidence(TENANT, "ev-1")!;
    expect(reloaded.support).toBe("unsupported");
    expect(reloaded.locator.endMs).toBe(141850);
  });
});
