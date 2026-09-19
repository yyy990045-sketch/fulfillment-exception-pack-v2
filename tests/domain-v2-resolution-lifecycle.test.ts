import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  V2SqliteStore,
  acceptExceptionForResolution,
  approveResolutionCase,
  closeResolutionCase,
  createEvidence,
  createSourceDocument,
  evaluateContextRules,
  executeResolutionCase,
  proposeResolutionCase,
  provisionV2DemoData,
  queryResolutionCase,
  reviewResolution,
  submitResolutionCase,
} from "../src/domain/v2/index.js";
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
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-resolution-life-"));
  const db = new sqlite!.DatabaseSync(join(dir, "resolution-life.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2DemoData(store);
  evaluateContextRules(store, "demo-industrial", "ctx-so-demo-001");
  return store;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function caseReadyToSubmit(store: V2SqliteStore, actor = resolutionActor("品质负责人")) {
  const exception = store.listExceptions("demo-industrial", "ctx-so-demo-001")
    .find((item) => item.code === "SHIPMENT_QUANTITY_SHORTFALL")!;
  let resolution = acceptExceptionForResolution(store, "demo-industrial", "ctx-so-demo-001", exception.id, {
    ownerRole: "品质负责人",
    rationale: "进入处置",
    actor: resolutionActor("销售总监"),
  });
  resolution = reviewResolution(store, "demo-industrial", resolution.id, {
    decision: "confirm",
    rationale: "确认异常",
    actor,
  })!;
  resolution = proposeResolutionCase(store, "demo-industrial", resolution.id, {
    actor,
    actions: [{ type: "supplement_evidence", summary: "核对材料，确认差异原因。" }],
  })!;
  return resolution;
}

function submittedCase(store: V2SqliteStore) {
  const resolution = caseReadyToSubmit(store, resolutionActor("品质负责人", ["品质负责人"], "reviewer-subject"));
  return submitResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("品质负责人"))!;
}

describe("V2 Resolution Case lifecycle", () => {
  it("requires submit before approval and enforces segregation of duties", () => {
    const store = openStore();
    const resolution = caseReadyToSubmit(store);
    expect(() => approveResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监")))
      .toThrow(/ACTION_NOT_APPLICABLE/);

    const submitted = submitResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("品质负责人"))!;
    expect(submitted.status).toBe("proposed");
    expect(submitted.runtime.status).toBe("proposed");
    expect(() => approveResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("品质负责人")))
      .toThrow(/SEGREGATION_OF_DUTIES_VIOLATION/);

    const approved = approveResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监"))!;
    expect(approved.status).toBe("approved");
    expect(approved.runtime.status).toBe("approved");
  });

  it("rejects repeated execution as not applicable", () => {
    const store = openStore();
    let resolution = caseReadyToSubmit(store);
    resolution = submitResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("品质负责人"))!;
    resolution = approveResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监"))!;
    const operationKey = "resolution-execute-1";
    const first = executeResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监"), operationKey)!;
    expect(first.status).toBe("executed");
    expect(first.runtime.status).toBe("executed");
    expect(() => executeResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监"), operationKey))
      .toThrow(/ACTION_NOT_APPLICABLE/);
    expect(store.listResolutionReceipts("demo-industrial", resolution.id)).toHaveLength(1);
  });

  it("rejects repeated closure as not applicable and preserves the first close", () => {
    const store = openStore();
    let resolution = caseReadyToSubmit(store);
    resolution = submitResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("品质负责人"))!;
    resolution = approveResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监"))!;
    resolution = executeResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监"), "close-test")!;
    resolution = closeResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监"))!;
    expect(() => closeResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("销售总监")))
      .toThrow(/ACTION_NOT_APPLICABLE/);
    expect(resolution.status).toBe("closed");
    expect(resolution.runtime.status).toBe("closed");
    expect(resolution.runtime.actions[0]?.status).toBe("verified");
  });

  it("reports sourceChanged without rewriting the intake snapshot", () => {
    const store = openStore();
    const resolution = caseReadyToSubmit(store);
    const initial = queryResolutionCase(store, "demo-industrial", resolution.id)!;
    expect(initial.sourceChanged).toBe(false);

    store.saveSourceDocument(createSourceDocument({
      id: "doc-shipment-demo-001-v2",
      tenantId: "demo-industrial",
      sourceSystemId: "WMS-DEMO",
      contextId: "ctx-so-demo-001",
      entityId: "entity-shipment-demo-001",
      externalDocumentId: "SH-DEMO-001",
      documentType: "shipment",
      contentHash: "8".repeat(64),
      receivedAt: "2026-09-20T00:00:00.000Z",
      effectiveAt: "2026-09-20T00:00:00.000Z",
      version: "v2",
      metadata: {},
    }));
    store.saveEvidence(createEvidence({
      id: "evidence-shipment-qty-v2",
      tenantId: "demo-industrial",
      contextId: "ctx-so-demo-001",
      sourceSystemId: "WMS-DEMO",
      sourceDocumentId: "doc-shipment-demo-001-v2",
      sourceVersion: "v2",
      entityId: "entity-shipment-demo-001",
      field: "qty",
      value: 94,
      valueType: "number",
      locator: { fileName: "SH-DEMO-001.csv", row: 3 },
      quote: "qty=94",
      confidence: 1,
      support: "supported",
      observedAt: "2026-09-20T00:00:00.000Z",
      createdAt: "2026-09-20T00:00:00.000Z",
      metadata: {},
    }));
    evaluateContextRules(store, "demo-industrial", "ctx-so-demo-001");
    const refreshed = queryResolutionCase(store, "demo-industrial", resolution.id)!;
    expect(refreshed.sourceChanged).toBe(true);
    expect(refreshed.intakeEvaluationId).toBe(resolution.origin.sourceRuleEvaluationId);
    expect(refreshed.currentEvaluationId).not.toBe(refreshed.intakeEvaluationId);
    expect(refreshed.evidenceBundle?.evidenceIds).toContain("evidence-shipment-qty-v2");
    expect(refreshed.evidenceBundle?.evidenceIds).not.toContain("evidence-shipment-qty");
    expect(refreshed.resolutionCase.origin).toEqual(resolution.origin);
    expect(refreshed.resolutionCase.status).toBe(resolution.status);
    expect(refreshed.resolutionCase.review).toEqual(resolution.review);
    expect(refreshed.resolutionCase.runtime.actions).toEqual(resolution.runtime.actions);
  });

  it("enforces authorization in the application boundary without HTTP", () => {
    const store = openStore();
    const exception = store.listExceptions("demo-industrial", "ctx-so-demo-001")[0]!;
    expect(() => acceptExceptionForResolution(store, "demo-industrial", "ctx-so-demo-001", exception.id, {
      ownerRole: "品质负责人",
      rationale: "只读身份不能进入治理",
      actor: resolutionActor("演示查看者", ["viewer"], "demo-viewer"),
    })).toThrow(/ROLE_NOT_ALLOWED/);
    expect(store.listResolutionCases("demo-industrial", "ctx-so-demo-001")).toHaveLength(0);
  });

  it("fails closed when review or proposal has no subjectId", () => {
    const store = openStore();
    const exception = store.listExceptions("demo-industrial", "ctx-so-demo-001")[0]!;
    const accepted = acceptExceptionForResolution(store, "demo-industrial", "ctx-so-demo-001", exception.id, {
      ownerRole: "品质负责人",
      rationale: "进入治理",
      actor: resolutionActor("品质负责人"),
    });
    expect(() => reviewResolution(store, "demo-industrial", accepted.id, {
      decision: "confirm",
      rationale: "缺少 subjectId",
      actor: { ...resolutionActor("品质负责人"), subjectId: "" },
    })).toThrow(/RESOLUTION_SUBJECT_ID_REQUIRED/);

    const reviewed = reviewResolution(store, "demo-industrial", accepted.id, {
      decision: "confirm",
      rationale: "确认",
      actor: resolutionActor("品质负责人"),
    })!;
    expect(() => proposeResolutionCase(store, "demo-industrial", reviewed.id, {
      actions: [{ type: "supplement_evidence", summary: "缺少 subjectId" }],
      actor: { ...resolutionActor("品质负责人"), subjectId: "" },
    })).toThrow(/RESOLUTION_SUBJECT_ID_REQUIRED/);
  });

  it("uses subjectId, not displayName, for segregation of duties", () => {
    const distinctSubjects = openStore();
    const resolvedByDifferentSubject = submittedCase(distinctSubjects);
    const approved = approveResolutionCase(
      distinctSubjects,
      "demo-industrial",
      resolvedByDifferentSubject.id,
      resolutionActor("王工", ["总经理"], "approver-subject"),
    )!;
    expect(approved.status).toBe("approved");

    const sameSubject = openStore();
    const resolvedBySameSubject = submittedCase(sameSubject);
    expect(() => approveResolutionCase(
      sameSubject,
      "demo-industrial",
      resolvedBySameSubject.id,
      resolutionActor("李总", ["总经理"], "reviewer-subject"),
    )).toThrow(/SEGREGATION_OF_DUTIES_VIOLATION/);
  });

  it("rejects illegal lifecycle transitions", () => {
    const triagedStore = openStore();
    const triagedException = triagedStore.listExceptions("demo-industrial", "ctx-so-demo-001")[0]!;
    const triaged = acceptExceptionForResolution(triagedStore, "demo-industrial", "ctx-so-demo-001", triagedException.id, {
      ownerRole: "品质负责人",
      rationale: "进入处置",
      actor: resolutionActor("销售总监"),
    });
    expect(() => proposeResolutionCase(triagedStore, "demo-industrial", triaged.id, {
      actor: resolutionActor("品质负责人"),
      actions: [{ type: "supplement_evidence", summary: "过早提交" }],
    })).toThrow(/ACTION_NOT_APPLICABLE/);
    const rejected = reviewResolution(triagedStore, "demo-industrial", triaged.id, {
      decision: "reject",
      rationale: "拒绝",
      actor: resolutionActor("品质负责人"),
    })!;
    expect(() => proposeResolutionCase(triagedStore, "demo-industrial", rejected.id, {
      actor: resolutionActor("品质负责人"),
      actions: [{ type: "supplement_evidence", summary: "不能复活" }],
    })).toThrow(/ACTION_NOT_APPLICABLE/);

    const confirmedStore = openStore();
    const confirmedException = confirmedStore.listExceptions("demo-industrial", "ctx-so-demo-001")[1]!;
    let confirmed = acceptExceptionForResolution(confirmedStore, "demo-industrial", "ctx-so-demo-001", confirmedException.id, {
      ownerRole: "品质负责人",
      rationale: "进入处置",
      actor: resolutionActor("销售总监"),
    });
    confirmed = reviewResolution(confirmedStore, "demo-industrial", confirmed.id, {
      decision: "confirm",
      rationale: "确认",
      actor: resolutionActor("品质负责人"),
    })!;
    expect(() => approveResolutionCase(confirmedStore, "demo-industrial", confirmed.id, resolutionActor("销售总监")))
      .toThrow(/ACTION_NOT_APPLICABLE/);

    const draftStore = openStore();
    let draft = caseReadyToSubmit(draftStore);
    expect(() => approveResolutionCase(draftStore, "demo-industrial", draft.id, resolutionActor("销售总监")))
      .toThrow(/ACTION_NOT_APPLICABLE/);
    draft = submitResolutionCase(draftStore, "demo-industrial", draft.id, resolutionActor("品质负责人"))!;
    expect(() => executeResolutionCase(draftStore, "demo-industrial", draft.id, resolutionActor("销售总监"), "too-early"))
      .toThrow(/ACTION_NOT_APPLICABLE/);
    draft = approveResolutionCase(draftStore, "demo-industrial", draft.id, resolutionActor("销售总监"))!;
    expect(() => closeResolutionCase(draftStore, "demo-industrial", draft.id, resolutionActor("销售总监")))
      .toThrow(/ACTION_NOT_APPLICABLE/);

    const noReceipt = {
      ...draft,
      status: "executed" as const,
      runtime: {
        ...draft.runtime,
        status: "executed" as const,
        actions: draft.runtime.actions.map((action) => ({ ...action, status: "authorized" as const })),
      },
    };
    draftStore.saveResolutionCase(noReceipt);
    expect(() => closeResolutionCase(draftStore, "demo-industrial", draft.id, resolutionActor("销售总监")))
      .toThrow(/RECEIPT_REQUIRED/);

    const closedStore = openStore();
    let closed = caseReadyToSubmit(closedStore);
    closed = submitResolutionCase(closedStore, "demo-industrial", closed.id, resolutionActor("品质负责人"))!;
    closed = approveResolutionCase(closedStore, "demo-industrial", closed.id, resolutionActor("销售总监"))!;
    closed = executeResolutionCase(closedStore, "demo-industrial", closed.id, resolutionActor("销售总监"), "closed-illegal")!;
    closed = closeResolutionCase(closedStore, "demo-industrial", closed.id, resolutionActor("销售总监"))!;
    expect(() => executeResolutionCase(closedStore, "demo-industrial", closed.id, resolutionActor("销售总监"), "closed-illegal"))
      .toThrow(/ACTION_NOT_APPLICABLE/);
    expect(() => proposeResolutionCase(closedStore, "demo-industrial", closed.id, {
      actor: resolutionActor("品质负责人"),
      actions: [{ type: "supplement_evidence", summary: "不能重开" }],
    })).toThrow(/ACTION_NOT_APPLICABLE/);
  });
});
