/**
 * Execution Read-Back Verification。
 *
 * 核心纪律：**API write 成功 ≠ 业务动作完成。**
 *
 *   requested   已请求下游动作
 *     ↓
 *   accepted    下游受理（write acknowledged）
 *     ↓  回读下游真实状态
 *   verified    回读状态与期望状态逐项一致
 *     ↓  任何不一致
 *   failed      绝不升级为 verified
 *
 * 在 simulator / local 环境里，"下游"是一个显式的模拟下游：
 * 它先接受动作、再给出可回读状态。真实接入后，同一接口换成真实 ERP/MES 客户端即可，
 * 状态机与判定逻辑不变。
 */
import type { V2SqliteStore } from "../domain/v2/index.js";
import {
  type ExecutionReadbackRecord,
  type ExecutionReadbackRequest,
  type ExecutionReadbackState,
} from "./types.js";

export type ExecutionDownstreamResult = {
  accepted: boolean;
  /** 下游回读出来的真实状态 */
  state: Record<string, string | number | boolean>;
  /** 下游自身的受理凭证（不含凭据） */
  reference: string;
  reason?: string;
};

export interface ExecutionDownstream {
  readonly name: string;
  /** 请求下游执行动作 */
  apply(request: ExecutionReadbackRequest): Promise<ExecutionDownstreamResult>;
  /** 独立回读下游当前状态（必须是**再次查询**，不能复用 apply 的返回值） */
  readBack(request: ExecutionReadbackRequest): Promise<Record<string, string | number | boolean>>;
}

/**
 * 模拟 MES 下游。
 *
 * 它只做一件事：把"补投产后的完工数量"落成可回读状态，并把回读结果作为
 * **新的 MES 证据**写入领域库（这是真实接入时下游回报的等价物）。
 * 它不会替人下结论，也不会自动批准任何动作。
 */
export class SimulatedMesExecutionDownstream implements ExecutionDownstream {
  readonly name = "simulated-mes";
  private readonly state = new Map<string, Record<string, string | number | boolean>>();

  constructor(private readonly options: {
    store: V2SqliteStore;
    tenantId: string;
    contextId: string;
    /** 是否在回读时故意返回不一致的状态（用于证明 failed 分支真实存在） */
    readBackMismatch?: boolean;
  }) {}

  async apply(request: ExecutionReadbackRequest): Promise<ExecutionDownstreamResult> {
    this.state.set(request.operationKey, { ...request.expected });
    return {
      accepted: true,
      state: { ...request.expected },
      reference: `mes-workorder-update:${request.operationKey}`,
    };
  }

  async readBack(request: ExecutionReadbackRequest): Promise<Record<string, string | number | boolean>> {
    const current = this.state.get(request.operationKey) ?? {};
    if (this.options.readBackMismatch) {
      const tampered: Record<string, string | number | boolean> = { ...current };
      for (const key of Object.keys(tampered)) {
        const value = tampered[key];
        if (value === undefined) continue;
        tampered[key] = typeof value === "number" ? value + 1 : value;
      }
      return tampered;
    }
    return { ...current };
  }
}

export function compareReadback(
  expected: Record<string, string | number | boolean>,
  actual: Record<string, string | number | boolean> | null,
): string[] {
  if (!actual) return ["READBACK_UNAVAILABLE"];
  const mismatches: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) {
      mismatches.push(`${key}:missing`);
      continue;
    }
    if (actual[key] !== value) mismatches.push(`${key}:expected=${String(value)}:actual=${String(actual[key])}`);
  }
  return mismatches.sort();
}

export type ExecuteWithReadbackInput = {
  request: ExecutionReadbackRequest;
  downstream: ExecutionDownstream;
  /** 执行成功后的本地回执 ID（来自既有 Resolution Receipt） */
  receiptId: string | null;
  now?: () => Date;
};

/**
 * 统一状态机：先 requested，再 accepted，再回读，最后 verified / failed。
 * 只有回读一致才允许 verified。
 */
export async function executeWithReadback(input: ExecuteWithReadbackInput): Promise<ExecutionReadbackRecord> {
  const now = input.now ?? (() => new Date());
  const requestedAt = now().toISOString();
  const base = {
    schemaVersion: "execution-readback/v1" as const,
    contextId: input.request.contextId,
    resolutionCaseId: input.request.resolutionCaseId,
    actionId: input.request.actionId,
    actionType: input.request.actionType,
    operationKey: input.request.operationKey,
    downstream: input.downstream.name,
    expected: input.request.expected,
    receiptId: input.receiptId,
    truthfulness: { apiWriteIsNotBusinessCompletion: true as const, causalAttribution: false as const },
  };

  let accepted: ExecutionDownstreamResult;
  try {
    accepted = await input.downstream.apply(input.request);
  } catch (error) {
    return {
      ...base,
      requestedAt,
      acceptedAt: null,
      verifiedAt: null,
      state: "failed",
      readBack: null,
      mismatches: [],
      reasons: [`DOWNSTREAM_APPLY_FAILED:${error instanceof Error ? error.name : "unknown"}`],
    };
  }
  const acceptedAt = now().toISOString();
  if (!accepted.accepted) {
    return {
      ...base,
      requestedAt,
      acceptedAt,
      verifiedAt: null,
      state: "failed",
      readBack: null,
      mismatches: [],
      reasons: [`DOWNSTREAM_REJECTED:${accepted.reason ?? accepted.reference}`],
    };
  }

  let readBack: Record<string, string | number | boolean> | null = null;
  try {
    readBack = await input.downstream.readBack(input.request);
  } catch {
    readBack = null;
  }
  const mismatches = compareReadback(input.request.expected, readBack);
  const verifiedAt = now().toISOString();
  const state: ExecutionReadbackState = mismatches.length === 0 ? "verified" : "failed";
  return {
    ...base,
    requestedAt,
    acceptedAt,
    verifiedAt,
    state,
    readBack,
    mismatches,
    reasons: state === "verified"
      ? [`READBACK_MATCHED:${input.downstream.name}`]
      : [`READBACK_MISMATCH:${mismatches.join("|")}`],
  };
}
