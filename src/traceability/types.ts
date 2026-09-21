/**
 * Traceability 层的类型。
 *
 * 这一层回答一个**能否执行**的问题，而不是一个"看起来对不对"的问题：
 *
 *   这条异常所依赖的证据，能不能一路回源到原始系统？
 *   能  → EVIDENCE_TRACE_VERIFIED
 *   不能 → EVIDENCE_NOT_VERIFIABLE（异常保留，但不允许进入审批/执行）
 *
 * 回源链（每一跳都必须成立）：
 *
 *   Exception → Rule Evaluation → Evidence → Source Ledger → rawHash
 *             → Mapping Version → Source Locator / UNS Topic → Canonical Industrial Event
 *             → Original Source System
 */

export const EVIDENCE_TRACE_SCHEMA_VERSION = "evidence-trace/v1";

/** 回源跳数：评委与工程师看到的是同一串固定层次。 */
export const EVIDENCE_TRACE_HOPS = [
  "exception",
  "rule_evaluation",
  "evidence",
  "source_ledger",
  "raw_hash",
  "mapping_version",
  "source_locator",
  "uns_topic",
  "canonical_industrial_event",
  "source_system",
] as const;

export type EvidenceTraceHop = (typeof EVIDENCE_TRACE_HOPS)[number];

/**
 * 回源模式。
 *
 * - `connector_required`：Context 带 UNS 绑定（工业主线）。每一跳都必须成立，否则阻断。
 * - `legacy_fixture`：Context 没有 UNS 绑定（历史合成 fixture，直接写入领域库）。
 *   该路径**不主张**连接器摄取来源，因此闸门明确标记为 not_applicable，
 *   而不是假装验证通过。此边界在文档与输出中始终可见。
 */
export type TraceabilityProvenanceMode = "connector_required" | "legacy_fixture";

export type TraceCheckStatus = "pass" | "fail";

export type TraceCheck = {
  id: string;
  hop: EvidenceTraceHop;
  label: string;
  status: TraceCheckStatus;
  detail: string;
};

export type TraceEvidenceProvenanceClass =
  /** 由连接器摄取，可回源到原始系统（唯一可用于决策依据的类别） */
  | "connector"
  /** 平台自身观测（例如执行后回读的下游回报）；**不主张**连接器来源，不得冒充源系统证据 */
  | "platform_observed"
  /** 既没有账本记录、也没有声明来源类别 —— 未知来源，一律不放行 */
  | "unknown";

export type TraceEvidenceLink = {
  evidenceId: string;
  provenanceClass: TraceEvidenceProvenanceClass;
  field: string;
  value: unknown;
  valueType: string;
  quote: string;
  observedAt: string;
  entityType: string | null;
  entityId: string | null;
  entityBusinessKey: string | null;
  sourceSystemId: string;
  sourceDocumentId: string;
  sourceVersion: string;
  role: string;
  ledger: {
    recordId: string;
    externalRecordId: string;
    rawHash: string;
    rawHashRecomputed: string | null;
    mappingId: string;
    mappingVersion: string;
    observedAt: string;
    canonicalRefs: number;
    evidenceRefs: number;
  } | null;
  locator: Record<string, unknown>;
  unsTopic: string | null;
  unsNamespace: string | null;
  canonicalEventId: string | null;
  sourceSystemKey: string | null;
  sourceSystemType: string | null;
  checks: TraceCheck[];
};

export type EvidenceTraceReport = {
  schemaVersion: typeof EVIDENCE_TRACE_SCHEMA_VERSION;
  tenantId: string;
  contextId: string;
  exceptionId: string | null;
  exceptionCode: string | null;
  provenanceMode: TraceabilityProvenanceMode;
  status: "EVIDENCE_TRACE_VERIFIED" | "EVIDENCE_NOT_VERIFIABLE" | "EVIDENCE_TRACE_NOT_APPLICABLE";
  payloadSource: {
    path: string | null;
    available: boolean;
    entries: number;
    unparsable: number;
  };
  hops: EvidenceTraceHop[];
  evidence: TraceEvidenceLink[];
  failures: string[];
  platformObservedCount: number;
  checkedAt: string;
};

/** 执行回读的四态。**API write 成功 ≠ 业务动作完成。** */
export type ExecutionReadbackState = "requested" | "accepted" | "verified" | "failed";

export type ExecutionReadbackRequest = {
  contextId: string;
  resolutionCaseId: string;
  actionId: string;
  actionType: string;
  operationKey: string;
  /** 期望的下游状态：read-back 必须逐项匹配，否则 failed */
  expected: Record<string, string | number | boolean>;
  /** 人类可读的动作意图（用于下游模拟与展示） */
  intent: string;
};

export type ExecutionReadbackRecord = {
  schemaVersion: "execution-readback/v1";
  contextId: string;
  resolutionCaseId: string;
  actionId: string;
  actionType: string;
  operationKey: string;
  downstream: string;
  requestedAt: string;
  acceptedAt: string | null;
  verifiedAt: string | null;
  state: ExecutionReadbackState;
  expected: Record<string, string | number | boolean>;
  readBack: Record<string, string | number | boolean> | null;
  mismatches: string[];
  receiptId: string | null;
  reasons: string[];
  truthfulness: {
    apiWriteIsNotBusinessCompletion: true;
    causalAttribution: false;
  };
};

export type TraceabilityGateStage = "approval" | "execution";

export type TraceabilityGateDecision = {
  stage: TraceabilityGateStage;
  applicable: boolean;
  allowed: boolean;
  status: "EVIDENCE_TRACE_VERIFIED" | "EVIDENCE_NOT_VERIFIABLE" | "EVIDENCE_TRACE_NOT_APPLICABLE";
  reasonCode: string;
  reason: string;
  failures: string[];
};

export class TraceabilityError extends Error {
  constructor(public readonly code: string, public readonly status = 409, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "TraceabilityError";
  }
}
