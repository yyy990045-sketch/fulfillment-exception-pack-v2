import { describe, expect, it } from "vitest";
import {
  SimulatedMesExecutionDownstream,
  compareReadback,
  executeWithReadback,
  type ExecutionDownstream,
  type ExecutionReadbackRequest,
} from "../src/traceability/index.js";

const request: ExecutionReadbackRequest = {
  contextId: "ctx-readback",
  resolutionCaseId: "resolution-case-1",
  actionId: "act-1",
  actionType: "create_task",
  operationKey: "op-1",
  expected: { productionCompletedQty: 100, remainingShortfall: 0 },
  intent: "补齐工单完工缺口",
};

function downstream(overrides: Partial<ExecutionDownstream> = {}): ExecutionDownstream {
  return {
    name: "test-downstream",
    async apply() {
      return { accepted: true, state: { ...request.expected }, reference: "ref-1" };
    },
    async readBack() {
      return { ...request.expected };
    },
    ...overrides,
  };
}

describe("Execution Read-Back Verification", () => {
  it("write 成功 + 回读一致 → verified（四态中的最后一态）", async () => {
    const record = await executeWithReadback({ request, downstream: downstream(), receiptId: "receipt-1" });
    expect(record.state).toBe("verified");
    expect(record.acceptedAt).not.toBeNull();
    expect(record.verifiedAt).not.toBeNull();
    expect(record.readBack).toEqual(request.expected);
    expect(record.mismatches).toEqual([]);
    expect(record.receiptId).toBe("receipt-1");
    expect(record.truthfulness.apiWriteIsNotBusinessCompletion).toBe(true);
    expect(record.truthfulness.causalAttribution).toBe(false);
  });

  it("write 成功但回读不一致 → failed，绝不升级为 verified", async () => {
    const record = await executeWithReadback({
      request,
      receiptId: "receipt-1",
      downstream: downstream({
        async readBack() {
          return { productionCompletedQty: 99, remainingShortfall: 1 };
        },
      }),
    });
    expect(record.state).toBe("failed");
    expect(record.state).not.toBe("verified");
    expect(record.mismatches).toEqual(["productionCompletedQty:expected=100:actual=99", "remainingShortfall:expected=0:actual=1"]);
    expect(record.reasons[0]).toMatch(/^READBACK_MISMATCH:/);
  });

  it("下游拒绝受理 → failed（accepted 都没到）", async () => {
    const record = await executeWithReadback({
      request,
      receiptId: null,
      downstream: downstream({ async apply() { return { accepted: false, state: {}, reference: "ref-1", reason: "rejected" }; } }),
    });
    expect(record.state).toBe("failed");
    expect(record.acceptedAt).not.toBeNull();
    expect(record.reasons[0]).toBe("DOWNSTREAM_REJECTED:rejected");
  });

  it("下游抛错 → failed", async () => {
    const record = await executeWithReadback({
      request,
      receiptId: null,
      downstream: downstream({ async apply() { throw new Error("boom"); } }),
    });
    expect(record.state).toBe("failed");
    expect(record.acceptedAt).toBeNull();
    expect(record.reasons[0]).toBe("DOWNSTREAM_APPLY_FAILED:Error");
  });

  it("回读不可用 → failed，不会当成一致", async () => {
    const record = await executeWithReadback({
      request,
      receiptId: null,
      downstream: downstream({ async readBack() { throw new Error("timeout"); } }),
    });
    expect(record.state).toBe("failed");
    expect(record.mismatches).toEqual(["READBACK_UNAVAILABLE"]);
  });

  it("期望键在下游状态里缺失 → failed", () => {
    expect(compareReadback({ a: 1, b: 2 }, { a: 1 })).toEqual(["b:missing"]);
    expect(compareReadback({ a: 1 }, { a: 1 })).toEqual([]);
    expect(compareReadback({ a: 1 }, null)).toEqual(["READBACK_UNAVAILABLE"]);
  });

  it("模拟 MES 下游：受理后回读与期望一致，可被 judge demo 直接使用", async () => {
    const mes = new SimulatedMesExecutionDownstream({
      store: { listEvidence: () => [] } as never,
      tenantId: "demo-manufacturing",
      contextId: "ctx-readback",
    });
    const accepted = await mes.apply(request);
    expect(accepted.accepted).toBe(true);
    expect(accepted.reference).toContain("mes-workorder-update");
    expect(await mes.readBack(request)).toEqual(request.expected);
  });

  it("模拟下游可切换成回读不一致，用于证明 failed 分支真实存在", async () => {
    const mes = new SimulatedMesExecutionDownstream({
      store: { listEvidence: () => [] } as never,
      tenantId: "demo-manufacturing",
      contextId: "ctx-readback",
      readBackMismatch: true,
    });
    const record = await executeWithReadback({ request, downstream: mes, receiptId: "r" });
    expect(record.state).toBe("failed");
    expect(record.mismatches.length).toBe(2);
  });
});
