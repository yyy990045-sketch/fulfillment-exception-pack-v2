/**
 * Traceability Gate —— 最小 fail-closed 闸门。
 *
 * 规则（只有这一条，但它是硬性的）：
 *
 *   异常可以存在；
 *   但如果这条异常所依赖的关键证据无法回源，
 *   它**不能**进入 governance approval，也**不能**进入 execution。
 *
 * 允许做的事：展示异常、解释异常、继续补证、重新抽取。
 * 不允许做的事：把"证据不可靠"的结论推进到批准与执行。
 *
 * 边界（刻意且可见，不是隐藏的例外）：
 *   闸门只在 Context 主张连接器/UNS 来源（provenanceMode = connector_required）时生效。
 *   历史合成 fixture（直接写入领域库、没有 UNS 绑定）会得到
 *   `EVIDENCE_TRACE_NOT_APPLICABLE`，闸门不适用 —— 它**不主张**可回源，
 *   因此既不会被假装验证通过，也不会静默放行一个真实主张。
 */
import type { EvidenceTraceReport, TraceabilityGateDecision, TraceabilityGateStage } from "./types.js";
import { buildEvidenceTrace, type BuildEvidenceTraceInput } from "./trace.js";

export function decideTraceabilityGate(input: {
  trace: EvidenceTraceReport;
  stage: TraceabilityGateStage;
}): TraceabilityGateDecision {
  const { trace, stage } = input;
  if (trace.status === "EVIDENCE_TRACE_NOT_APPLICABLE") {
    return {
      stage,
      applicable: false,
      allowed: true,
      status: trace.status,
      reasonCode: "LEGACY_FIXTURE_PROVENANCE",
      reason: "该 Context 不主张连接器来源（历史合成 fixture），回源闸门不适用。",
      failures: trace.failures,
    };
  }
  if (trace.status === "EVIDENCE_TRACE_VERIFIED") {
    // 即便整条链都成立，决策依据也**必须**是连接器回源证据：
    // 平台自观测（例如执行后回读）可以展示，但不能拿来支撑审批与执行。
    const nonConnector = trace.evidence.filter((item) => item.provenanceClass !== "connector");
    if (nonConnector.length) {
      return {
        stage,
        applicable: true,
        allowed: false,
        status: "EVIDENCE_NOT_VERIFIABLE",
        reasonCode: "EVIDENCE_NOT_CONNECTOR_BACKED",
        reason: "决策依据中存在非连接器回源证据，不能进入审批与执行。",
        failures: nonConnector.map((item) => `${item.evidenceId}:provenance=${item.provenanceClass}`),
      };
    }
    return {
      stage,
      applicable: true,
      allowed: true,
      status: trace.status,
      reasonCode: "EVIDENCE_TRACE_VERIFIED",
      reason: "关键证据已全部回源，允许进入审批与执行。",
      failures: [],
    };
  }
  return {
    stage,
    applicable: true,
    allowed: false,
    status: "EVIDENCE_NOT_VERIFIABLE",
    reasonCode: "EVIDENCE_NOT_VERIFIABLE",
    reason: stage === "approval"
      ? "关键证据无法回源，异常保留但不得进入审批。"
      : "关键证据无法回源，异常保留但不得进入执行。",
    failures: trace.failures,
  };
}

/** 便捷入口：直接按 Context/Exception 计算 trace 并给出闸门结论。 */
export function evaluateTraceabilityGate(
  input: BuildEvidenceTraceInput & { stage: TraceabilityGateStage },
) {
  const trace = buildEvidenceTrace(input);
  return { trace, decision: decideTraceabilityGate({ trace, stage: input.stage }) };
}

export function assertTraceabilityGate(input: {
  trace: EvidenceTraceReport;
  stage: TraceabilityGateStage;
}) {
  const decision = decideTraceabilityGate(input);
  if (!decision.allowed) {
    const error = new Error(decision.reasonCode) as Error & { reasonCode?: string; failures?: string[] };
    error.reasonCode = decision.reasonCode;
    error.failures = decision.failures;
    throw error;
  }
  return decision;
}
