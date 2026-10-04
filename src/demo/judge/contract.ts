/**
 * Judge Contract v1.0 的最小读模型。
 *
 * 它消费已经进入 UNS 的四源事实，不写回任何来源系统，也不把
 * Disposition 当成 ObservedStateConflict 的替代品。
 */

import { existsSync, readFileSync } from "node:fs";

export const JUDGE_CONTRACT_VERSION = "FULFILLMENT_STATE_CONFLICT@1.0" as const;
export const JUDGE_GRACE_HOURS = 1;

export type JudgeCaseId = "A" | "B" | "C" | "D" | "E";
export type JudgeCaseStatus =
  | "NO_CONFLICT"
  | "WAITING_FOR_SOURCE_PROGRESS"
  | "FULFILLMENT_STATE_CONFLICT"
  | "WAITING_FOR_EXECUTION_VERIFICATION"
  | "REVALIDATED_CLOSED";

export type JudgeContractFacts = {
  businessKey: "SO-IND-001";
  sourceOrderLineRef: string;
  workOrderRef: string;
  productionLotRef: string;
  shipmentSourceRef: string;
  requiredQty: number;
  dueAt: string;
  completedQty: number;
  productionState: "terminal" | "in_progress";
  releasedQty: number;
  executionCommittedQty: number;
  sourceProgress: Record<"ERP" | "MES" | "QMS" | "WMS", string>;
};

export type JudgeDisposition = {
  status: "none" | "AUTHORIZED_SHORT_SHIPMENT_96";
  authorizedQty: number | null;
  authority: "none" | "DEMO_POLICY_DUAL_ROLE";
};

export type JudgeContractEvaluation = {
  caseId: JudgeCaseId;
  label: string;
  facts: JudgeContractFacts;
  disposition: JudgeDisposition;
  lineage: {
    status: "RESOLVED" | "NOT_EVALUABLE";
    relation: string;
  };
  asOf: string;
  dueAtWithGrace: string;
  globalWatermark: string;
  observedStateConflict: boolean;
  status: JudgeCaseStatus;
  reason: string;
  externalObligation: string;
};

export type JudgeContractProjection = {
  version: "judge-contract/v1.0";
  contract: typeof JUDGE_CONTRACT_VERSION;
  businessKey: "SO-IND-001";
  industrialContext: {
    enterpriseId: string;
    siteId: string;
    areaId: string;
    lineId: string;
  } | null;
  currentCase: JudgeCaseId;
  facts: JudgeContractFacts;
  sourceSystems: Array<"ERP" | "MES" | "QMS" | "WMS">;
  lineage: JudgeContractEvaluation["lineage"];
  cases: JudgeContractEvaluation[];
  realOpenSuposRuntimeVerified: false;
};

const SOURCE_SYSTEMS = ["ERP", "MES", "QMS", "WMS"] as const;

function plusHours(iso: string, hours: number) {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}

function minIso(values: string[]) {
  return [...values].sort()[0] ?? "";
}

function evaluate(input: {
  caseId: JudgeCaseId;
  label: string;
  facts: JudgeContractFacts;
  disposition?: JudgeDisposition;
  closedAfterRevalidation?: boolean;
}): JudgeContractEvaluation {
  const disposition = input.disposition ?? { status: "none", authorizedQty: null, authority: "none" };
  const dueAtWithGrace = plusHours(input.facts.dueAt, JUDGE_GRACE_HOURS);
  const globalWatermark = minIso(Object.values(input.facts.sourceProgress));
  const lineageResolved = Boolean(
    input.facts.sourceOrderLineRef && input.facts.workOrderRef &&
    input.facts.productionLotRef && input.facts.shipmentSourceRef,
  );
  const ready = globalWatermark >= dueAtWithGrace;
  const observedStateConflict = lineageResolved && ready && input.facts.productionState === "terminal"
    && input.facts.releasedQty < input.facts.requiredQty
    && input.facts.executionCommittedQty > input.facts.releasedQty;

  let status: JudgeCaseStatus;
  let reason: string;
  if (!lineageResolved) {
    status = "WAITING_FOR_SOURCE_PROGRESS";
    reason = "业务关联尚未确认，不能评价这组来源事实。";
  } else if (!ready) {
    status = "WAITING_FOR_SOURCE_PROGRESS";
    reason = "ERP、MES、QMS、WMS 尚未推进到交期后的共同水位。";
  } else if (input.closedAfterRevalidation && !observedStateConflict) {
    status = "REVALIDATED_CLOSED";
    reason = "新 WMS 来源事实到达，共同水位推进后重新验证通过。";
  } else if (observedStateConflict && disposition.status !== "none") {
    status = "WAITING_FOR_EXECUTION_VERIFICATION";
    reason = "已授权内部短交处置，但 WMS 现实执行仍为 100，冲突仍由来源事实决定。";
  } else if (observedStateConflict) {
    status = "FULFILLMENT_STATE_CONFLICT";
    reason = "四源事实已在同一业务关系和共同水位上形成不可一致解释的履约状态。";
  } else {
    status = "NO_CONFLICT";
    reason = "共同水位已就绪，跨系统履约约束成立。";
  }

  return {
    caseId: input.caseId,
    label: input.label,
    facts: input.facts,
    disposition,
    lineage: {
      status: lineageResolved ? "RESOLVED" : "NOT_EVALUABLE",
      relation: `${input.facts.sourceOrderLineRef} → ${input.facts.workOrderRef} → ${input.facts.productionLotRef} → ${input.facts.shipmentSourceRef}`,
    },
    asOf: globalWatermark,
    dueAtWithGrace,
    globalWatermark,
    observedStateConflict,
    status,
    reason,
    externalObligation: "ERP.requiredQty 仍为 100 件；内部处置不改变对外订单承诺。",
  };
}

export function buildJudgeContractProjection(input: {
  facts: JudgeContractFacts;
  industrialContext?: JudgeContractProjection["industrialContext"];
}): JudgeContractProjection {
  const base = input.facts;
  const readyProgress = base.sourceProgress;
  const waitingProgress = { ...readyProgress, QMS: plusHours(base.dueAt, -1) };
  const normalFacts: JudgeContractFacts = {
    ...base,
    completedQty: 100,
    releasedQty: 100,
    executionCommittedQty: 100,
  };
  const conflictFacts: JudgeContractFacts = {
    ...base,
    completedQty: 96,
    releasedQty: 96,
    executionCommittedQty: 100,
  };
  const revalidatedProgress = Object.fromEntries(
    SOURCE_SYSTEMS.map((system) => [system, plusHours(readyProgress[system] || base.dueAt, 1)]),
  ) as JudgeContractFacts["sourceProgress"];
  const revalidatedFacts: JudgeContractFacts = {
    ...conflictFacts,
    executionCommittedQty: 96,
    sourceProgress: revalidatedProgress,
  };

  return {
    version: "judge-contract/v1.0",
    contract: JUDGE_CONTRACT_VERSION,
    businessKey: "SO-IND-001",
    industrialContext: input.industrialContext ?? null,
    currentCase: "C",
    facts: conflictFacts,
    sourceSystems: [...SOURCE_SYSTEMS],
    lineage: evaluate({ caseId: "C", label: "真冲突", facts: conflictFacts }).lineage,
    cases: [
      evaluate({ caseId: "A", label: "正常", facts: normalFacts }),
      evaluate({ caseId: "B", label: "数据未就绪", facts: { ...conflictFacts, sourceProgress: waitingProgress } }),
      evaluate({ caseId: "C", label: "真冲突", facts: conflictFacts }),
      evaluate({
        caseId: "D",
        label: "已有授权处置，但现实没变",
        facts: conflictFacts,
        disposition: { status: "AUTHORIZED_SHORT_SHIPMENT_96", authorizedQty: 96, authority: "DEMO_POLICY_DUAL_ROLE" },
      }),
      evaluate({
        caseId: "E",
        label: "新来源事实到达",
        facts: revalidatedFacts,
        disposition: { status: "AUTHORIZED_SHORT_SHIPMENT_96", authorizedQty: 96, authority: "DEMO_POLICY_DUAL_ROLE" },
        closedAfterRevalidation: true,
      }),
    ],
    realOpenSuposRuntimeVerified: false,
  };
}

export function factsFromUnsMessages(messages: Array<{ payload: string }>): JudgeContractFacts {
  const facts: JudgeContractFacts = {
    businessKey: "SO-IND-001",
    sourceOrderLineRef: "",
    workOrderRef: "",
    productionLotRef: "",
    shipmentSourceRef: "",
    requiredQty: 0,
    dueAt: "",
    completedQty: 0,
    productionState: "in_progress",
    releasedQty: 0,
    executionCommittedQty: 0,
    sourceProgress: { ERP: "", MES: "", QMS: "", WMS: "" },
  };
  for (const message of messages) {
    let envelope: Record<string, any>;
    try { envelope = JSON.parse(message.payload) as Record<string, any>; } catch { continue; }
    const system = String(envelope.source?.systemType ?? "").toUpperCase() as keyof typeof facts.sourceProgress;
    const eventType = String(envelope.event?.eventType ?? "");
    const sourceRelations = envelope.metadata?.simulation?.lineage ?? {};
    const sourceProgressAt = String(envelope.metadata?.simulation?.sourceProgressAt ?? envelope.event?.occurredAt ?? "");
    if (SOURCE_SYSTEMS.includes(system)) {
      facts.sourceProgress[system] = facts.sourceProgress[system] > sourceProgressAt ? facts.sourceProgress[system] : sourceProgressAt;
    }
    facts.sourceOrderLineRef ||= String(sourceRelations.sourceOrderLineRef ?? "");
    facts.workOrderRef ||= String(sourceRelations.workOrderRef ?? "");
    facts.productionLotRef ||= String(sourceRelations.productionLotRef ?? "");
    facts.shipmentSourceRef ||= String(sourceRelations.shipmentSourceRef ?? "");
    const values = Object.fromEntries(Object.entries(envelope.facts ?? {}).map(([key, item]) => [key, (item as { value?: unknown })?.value]));
    if (system === "ERP" && eventType === "ORDER_CREATED") {
      facts.requiredQty = Number(values.qty ?? facts.requiredQty);
      facts.dueAt = String(values.dueAt ?? facts.dueAt);
    }
    if (system === "MES" && eventType === "PRODUCTION_COMPLETED") {
      facts.completedQty = Number(values.completedQty ?? facts.completedQty);
      facts.productionState = "terminal";
    }
    if (system === "QMS" && eventType === "QUALITY_PASSED") facts.releasedQty = Number(values.passedQty ?? facts.releasedQty);
    if (system === "WMS" && eventType === "SHIPMENT_DISPATCHED") facts.executionCommittedQty = Number(values.executionCommittedQty ?? facts.executionCommittedQty);
  }
  return facts;
}

export function readJudgeContractArtifact(path: string | null): JudgeContractProjection | null {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JudgeContractProjection;
  } catch {
    return null;
  }
}
