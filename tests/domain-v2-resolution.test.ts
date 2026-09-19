import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  V2SqliteStore,
  acceptExceptionForResolution,
  evaluateContextRules,
  proposeResolutionCase,
  provisionV2DemoData,
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
  const dir = mkdtempSync(join(tmpdir(), "fep-v2-resolution-"));
  const db = new sqlite!.DatabaseSync(join(dir, "resolution.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2DemoData(store);
  evaluateContextRules(store, "demo-industrial", "ctx-so-demo-001");
  return store;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function shipmentException(store: V2SqliteStore) {
  return store.listExceptions("demo-industrial", "ctx-so-demo-001").find((item) => item.code === "SHIPMENT_QUANTITY_SHORTFALL")!;
}

describe("V2 Exception to Resolution Case bridge", () => {
  it("does not create Resolution Cases during rule execution", () => {
    const store = openStore();
    expect(store.listExceptions("demo-industrial", "ctx-so-demo-001")).toHaveLength(3);
    expect(store.listResolutionCases("demo-industrial", "ctx-so-demo-001")).toHaveLength(0);
  });

  it("creates one triaged case only after human acceptance and freezes intake lineage", () => {
    const store = openStore();
    const exception = shipmentException(store);
    const first = acceptExceptionForResolution(store, "demo-industrial", "ctx-so-demo-001", exception.id, {
      ownerRole: "品质负责人",
      rationale: "确认需要进入人工处置",
      actor: resolutionActor("销售总监"),
    });

    expect(first.id).toBe("resolution-case-exc-" + first.exceptionId.slice(4));
    expect(first.status).toBe("triaged");
    expect(first.runtime.events.map((event) => event.reason)).toEqual(["v2_exception_intake", "接受异常进入处置"]);
    expect(first.origin.sourceRuleEvaluationId).toBe(exception.latestRuleEvaluationId);
    expect(first.origin.evidenceRefs).toEqual([
      { evidenceId: "evidence-order-qty", role: "expected" },
      { evidenceId: "evidence-shipment-qty", role: "actual" },
    ]);
    expect(() => acceptExceptionForResolution(store, "demo-industrial", "ctx-so-demo-001", exception.id, {
      ownerRole: "品质负责人",
      rationale: "重复提交",
      actor: resolutionActor("销售总监"),
    })).toThrow(/ACTION_NOT_APPLICABLE/);
    expect(store.listResolutionCases("demo-industrial", "ctx-so-demo-001")).toHaveLength(1);
  });

  it("supports review, proposal, and submit approval without invoking V1 propose()", () => {
    const store = openStore();
    const exception = shipmentException(store);
    let resolution = acceptExceptionForResolution(store, "demo-industrial", "ctx-so-demo-001", exception.id, {
      ownerRole: "品质负责人",
      rationale: "确认需要进入人工处置",
      actor: resolutionActor("销售总监"),
    });
    resolution = reviewResolution(store, "demo-industrial", resolution.id, {
      decision: "needs_evidence",
      rationale: "先补充签收材料",
      actor: resolutionActor("品质负责人"),
    })!;
    expect(resolution.status).toBe("triaged");
    resolution = reviewResolution(store, "demo-industrial", resolution.id, {
      decision: "confirm",
      rationale: "证据足够进入处置",
      actor: resolutionActor("品质负责人"),
    })!;
    expect(resolution.status).toBe("confirmed");
    expect(() => reviewResolution(store, "demo-industrial", resolution.id, {
      decision: "reject",
      rationale: "不能复活",
      actor: resolutionActor("品质负责人"),
    })).toThrow(/ACTION_NOT_APPLICABLE/);

    resolution = proposeResolutionCase(store, "demo-industrial", resolution.id, {
      actor: resolutionActor("品质负责人"),
      actions: [{ type: "supplement_evidence", summary: "核对订单、发货及后续签收材料，确认数量差异原因。" }],
    })!;
    expect(resolution.status).toBe("proposed");
    expect(resolution.proposedBy).toBe("品质负责人");
    expect(resolution.runtime.actions[0]).toMatchObject({
      type: "supplement_evidence",
      status: "draft",
      requiresApproval: true,
      idempotencyKey: `${resolution.id}:supplement_evidence:1`,
    });
    expect(() => proposeResolutionCase(store, "demo-industrial", resolution.id, {
      actor: resolutionActor("品质负责人"),
      actions: [{ type: "supplement_evidence", summary: "不应重复" }],
    })).toThrow(/ACTION_NOT_APPLICABLE/);

    resolution = submitResolutionCase(store, "demo-industrial", resolution.id, resolutionActor("品质负责人"))!;
    expect(resolution.runtime.actions[0]?.status).toBe("pending_approval");
  });

  it("keeps needs_evidence as triaged and reject as terminal", () => {
    const store = openStore();
    const exception = shipmentException(store);
    let resolution = acceptExceptionForResolution(store, "demo-industrial", "ctx-so-demo-001", exception.id, {
      ownerRole: "品质负责人",
      rationale: "进入人工判断",
      actor: resolutionActor("销售总监"),
    });
    resolution = reviewResolution(store, "demo-industrial", resolution.id, {
      decision: "reject",
      rationale: "无需继续处置",
      actor: resolutionActor("品质负责人"),
    })!;
    expect(resolution.status).toBe("rejected");
    expect(() => reviewResolution(store, "demo-industrial", resolution.id, {
      decision: "confirm",
      rationale: "不能复活",
      actor: resolutionActor("品质负责人"),
    })).toThrow(/ACTION_NOT_APPLICABLE/);
  });
});
