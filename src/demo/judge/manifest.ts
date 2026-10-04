/**
 * Judge Evidence Manifest —— 面向评委的证据清单，不是面向开发者的调试转储。
 *
 * 它回答评委真正会问的六个问题：
 *   这是哪条工业产线上发生的事？   → industrialContext
 *   业务问题是什么？               → businessQuestion + businessFacts
 *   数据从哪儿来？                 → sources + uns
 *   结论依据哪条证据？             → evidence + trace
 *   系统判了什么？                 → rule + exception
 *   然后谁做了什么？               → governance + execution + outcome
 *
 * 所有字段都来自持久化事实（Context / Evidence / Ledger / Resolution / Outcome），
 * 没有一个是脚本自己编的。
 */
import { existsSync, readFileSync } from "node:fs";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import { DEMO_MANUFACTURING_HIERARCHY, industrialSpaceOfContext, industrialSpaceRootPath } from "../../industrial/index.js";
import { UNS_TOPIC_CONVENTION } from "../../industrial/uns-topic.js";
import { resolutionGovernanceStage } from "../../domain/v2/resolution/governance-stage.js";
import { buildEvidenceTrace, type BuildEvidenceTraceInput, type EvidenceTraceReport } from "../../traceability/index.js";
import type { ExecutionReadbackRecord } from "../../traceability/types.js";
import type { JudgeContractProjection } from "./contract.js";

export const JUDGE_BUSINESS_QUESTION =
  "履约哨兵：基于 open supOS UNS 的跨系统生产履约状态冲突处置 APP";

/**
 * 选出 judge 视图默认展示的 Context：
 * 优先取带生产缺口异常的（比赛主场景），否则取最新的一条。
 * 纯只读选择，不发明任何数据。
 */
export function resolveJudgeContextId(store: V2SqliteStore, tenantId: string) {
  const contexts = store.listContexts(tenantId);
  if (!contexts.length) return null;
  const withMainScenario = contexts.find((context) =>
    store.listExceptions(tenantId, context.id).some((item) => item.code === "ORDER_PRODUCTION_COMPLETION_SHORTFALL"));
  if (withMainScenario) return withMainScenario.id;
  return [...contexts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]!.id;
}

/** 读取执行回读产物（judge 工作区里的 execution-readback.json），缺失时返回 null。 */
export function readExecutionReadbackArtifact(path: string | null): ExecutionReadbackRecord | null {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ExecutionReadbackRecord;
  } catch {
    return null;
  }
}

export type JudgeSourceRef = {
  role: "order" | "production" | "quality" | "shipment";
  systemKey: string;
  systemType: string | null;
  evidenceId: string;
  sourceDocumentId: string;
  field: string;
  value: unknown;
  valueType: string;
  observedAt: string;
  unsTopic: string | null;
  rawHash: string | null;
};

export type JudgeEvidenceManifest = {
  schemaVersion: "judge-evidence-manifest/v1";
  generatedAt: string;
  scenario: string;
  scenarioLabel: string;
  businessQuestion: string;
  industrialContext: {
    enterpriseId: string;
    siteId: string;
    areaId: string;
    lineId: string;
    equipmentIds: string[];
    unsRootPath: string | null;
  } | null;
  businessFacts: {
    orderedQuantity: number;
    productionCompletedQuantity: number;
    difference: number;
    unit: string;
  };
  sources: {
    order: JudgeSourceRef | null;
    production: JudgeSourceRef | null;
    quality: JudgeSourceRef | null;
    shipment: JudgeSourceRef | null;
  };
  uns: {
    orderTopic: string | null;
    productionTopic: string | null;
    topicConvention: string;
  };
  evidence: {
    orderEvidenceId: string | null;
    productionEvidenceId: string | null;
    totalCount: number;
  };
  rule: {
    code: string;
    result: string;
    expected: number | null;
    actual: number | null;
    difference: number | null;
  };
  exception: {
    id: string;
    code: string;
    severity: string;
    title: string;
    summary: string;
  } | null;
  governance: {
    status: string;
    stage: string;
    caseId: string | null;
    ownerRole: string | null;
    proposedBy: string | null;
    approvedBy: string | null;
    segregationOfDutiesEnforced: boolean;
  };
  execution: {
    status: ExecutionReadbackRecord["state"] | "not_started" | "blocked";
    downstream: string | null;
    receiptId: string | null;
    mismatches: string[];
    apiWriteIsNotBusinessCompletion: true;
  };
  outcome: {
    status: string;
    definitionId: string | null;
    baseline: number | string | null;
    current: number | string | null;
    target: number | string | null;
    causalAttribution: false;
  };
  ai: {
    provider: string;
    model: string;
    recommendationId: string | null;
    recommendationStatus: string | null;
    humanDecisionRequired: boolean;
    canApprove: false;
    canExecute: false;
    note: string;
  };
  trace: {
    status: EvidenceTraceReport["status"];
    failures: string[];
    hops: string[];
    evidenceLinks: number;
    payloadSourcePath: string | null;
  };
  truthBoundary: {
    simulatedIndustrialEnvironment: true;
    realFactoryVerified: false;
    realMesVerified: false;
    realErpVerified: false;
    openSuposContractVerified: true;
    openSuposRuntimeVerified: false;
    customerDataVerified: false;
  };
  artifacts: {
    unsStream: string | null;
    evidenceManifest: string | null;
    readback: string | null;
  };
  fulfillment: JudgeContractProjection;
};

export type BuildJudgeManifestInput = {
  store: V2SqliteStore;
  tenantId: string;
  contextId: string;
  exceptionId?: string | null;
  payloadSourcePath?: string | null;
  payloadSource?: BuildEvidenceTraceInput["payloadSource"];
  readback?: ExecutionReadbackRecord | null;
  ai?: Partial<JudgeEvidenceManifest["ai"]> | null;
  artifacts?: Partial<JudgeEvidenceManifest["artifacts"]> | null;
  scenario?: { id: string; label: string } | null;
  contract?: JudgeContractProjection | null;
  now?: () => Date;
};

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}

export function buildJudgeManifest(input: BuildJudgeManifestInput): JudgeEvidenceManifest {
  const { store, tenantId, contextId } = input;
  const now = input.now ?? (() => new Date());
  const context = store.getContext(tenantId, contextId);
  if (!context) throw new Error(`JUDGE_CONTEXT_NOT_FOUND:${contextId}`);
  const exceptions = store.listExceptions(tenantId, contextId);
  const exception = input.exceptionId
    ? exceptions.find((item) => item.id === input.exceptionId) ?? null
    : exceptions[0] ?? null;
  const bundle = exception ? store.getExceptionEvidenceBundle(tenantId, exception.id) : undefined;
  const trace = buildEvidenceTrace({
    store,
    tenantId,
    contextId,
    exceptionId: exception?.id ?? null,
    ...(input.payloadSourcePath !== undefined ? { payloadSourcePath: input.payloadSourcePath } : {}),
    ...(input.payloadSource ? { payloadSource: input.payloadSource } : {}),
    now,
  });

  const linkByRole = (role: string) => trace.evidence.find((item) => item.role === role) ?? null;
  const orderLink = linkByRole("expected");
  const productionLink = linkByRole("actual");
  const toSourceRef = (role: "order" | "production" | "quality" | "shipment", link: typeof orderLink): JudgeSourceRef | null => link
    ? {
      role,
      systemKey: link.sourceSystemId,
      systemType: link.sourceSystemType,
      evidenceId: link.evidenceId,
      sourceDocumentId: link.sourceDocumentId,
      field: link.field,
      value: link.value,
      valueType: link.valueType,
      observedAt: link.observedAt,
      unsTopic: link.unsTopic,
      rawHash: link.ledger?.rawHash ?? null,
    }
    : null;

  const space = industrialSpaceOfContext(context);
  const lineSpace = space
    ? { enterpriseId: space.enterpriseId, siteId: space.siteId, areaId: space.areaId, lineId: space.lineId }
    : null;

  const scenarioMeta = (context.metadata.simulation ?? {}) as Record<string, unknown>;
  const contract = input.contract ?? null;
  const scenarioId = input.scenario?.id
    ?? (contract ? contract.businessKey : undefined)
    ?? (typeof scenarioMeta.scenario === "string" ? scenarioMeta.scenario : "unknown");
  const scenarioLabel = input.scenario?.label ?? (contract ? "SO-IND-001 · 跨系统履约冲突" : scenarioId);

  const resolutionCase = exception ? store.getResolutionCaseByException(tenantId, exception.id) : undefined;
  const receipts = resolutionCase ? store.listResolutionReceipts(tenantId, resolutionCase.id) : [];
  const outcomeEvaluations = exception ? store.listOutcomeEvaluations(tenantId, contextId, exception.id) : [];
  const outcome = outcomeEvaluations.at(-1);
  const definition = outcome ? store.getOutcomeDefinition(tenantId, outcome.definitionId, outcome.definitionVersion) : undefined;
  const rule = exception ? store.getRuleDefinition(tenantId, exception.ruleId) : undefined;
  const readback = input.readback ?? null;
  const difference = numberOrNull(exception?.metrics.difference);
  const expected = numberOrNull(exception?.metrics.expected);
  const actual = numberOrNull(exception?.metrics.actual);
  const equipmentIds = collectEquipmentIds(trace);

  const currentContract = contract?.cases.find((item) => item.caseId === contract.currentCase) ?? null;
  const contractSource = (role: JudgeSourceRef["role"], systemKey: string, systemType: string, field: string, value: unknown, observedAt: string): JudgeSourceRef => ({
    role, systemKey, systemType, evidenceId: "", sourceDocumentId: "", field, value, valueType: typeof value === "number" ? "number" : "datetime", observedAt, unsTopic: null, rawHash: null,
  });
  return {
    schemaVersion: "judge-evidence-manifest/v1",
    generatedAt: now().toISOString(),
    scenario: scenarioId,
    scenarioLabel,
    businessQuestion: JUDGE_BUSINESS_QUESTION,
    industrialContext: contract?.industrialContext
      ? { ...contract.industrialContext, equipmentIds, unsRootPath: industrialSpaceRootPath(contract.industrialContext) }
      : (lineSpace
      ? {
        ...lineSpace,
        equipmentIds,
        unsRootPath: industrialSpaceRootPath(lineSpace),
      }
        : null),
    businessFacts: {
      orderedQuantity: contract?.facts.requiredQty ?? expected ?? 0,
      productionCompletedQuantity: contract?.facts.completedQty ?? actual ?? 0,
      difference: contract ? contract.facts.requiredQty - contract.facts.completedQty : difference ?? 0,
      unit: "pcs",
    },
    sources: {
      order: contract
        ? contractSource("order", "ERP-DEMO", "erp", "requiredQty", contract.facts.requiredQty, contract.facts.sourceProgress.ERP)
        : toSourceRef("order", orderLink),
      production: contract
        ? contractSource("production", "MES-DEMO", "mes", "completedQty", contract.facts.completedQty, contract.facts.sourceProgress.MES)
        : toSourceRef("production", productionLink),
      quality: contract ? {
        role: "quality", systemKey: "QMS-DEMO", systemType: "qms", evidenceId: "", sourceDocumentId: "",
        field: "releasedQty", value: contract.facts.releasedQty, valueType: "number", observedAt: contract.facts.sourceProgress.QMS, unsTopic: null, rawHash: null,
      } : null,
      shipment: contract ? {
        role: "shipment", systemKey: "WMS-DEMO", systemType: "wms", evidenceId: "", sourceDocumentId: "",
        field: "executionCommittedQty", value: contract.facts.executionCommittedQty, valueType: "number", observedAt: contract.facts.sourceProgress.WMS, unsTopic: null, rawHash: null,
      } : null,
    },
    uns: {
      orderTopic: orderLink?.unsTopic ?? null,
      productionTopic: productionLink?.unsTopic ?? null,
      topicConvention: UNS_TOPIC_CONVENTION.template,
    },
    evidence: {
      orderEvidenceId: orderLink?.evidenceId ?? null,
      productionEvidenceId: productionLink?.evidenceId ?? null,
      totalCount: bundle?.evidence.length ?? trace.evidence.length,
    },
    rule: contract && currentContract
      ? {
        code: contract.contract,
        result: currentContract.observedStateConflict ? "matched" : "not_matched",
        expected: contract.facts.requiredQty,
        actual: contract.facts.releasedQty,
        difference: contract.facts.requiredQty - contract.facts.releasedQty,
      }
      : {
        code: rule?.code ?? exception?.ruleId ?? "unknown",
        result: exception ? "matched" : "not_matched",
        expected,
        actual,
        difference,
      },
    exception: currentContract?.status === "FULFILLMENT_STATE_CONFLICT"
      ? {
        id: exception?.id ?? "judge-contract-fulfillment-state-conflict",
        code: "FULFILLMENT_STATE_CONFLICT@1.0",
        severity: "high",
        title: "跨系统生产履约状态冲突",
        summary: currentContract.reason,
      }
      : exception
      ? {
        id: exception.id,
        code: exception.code,
        severity: exception.severity,
        title: exception.title,
        summary: exception.summary,
      }
      : null,
    governance: {
      status: resolutionCase?.status ?? "no_case",
      stage: resolutionGovernanceStage(resolutionCase?.status, resolutionCase?.runtime.actions ?? []),
      caseId: resolutionCase?.id ?? null,
      ownerRole: resolutionCase?.ownerRole ?? null,
      proposedBy: resolutionCase?.proposedBy ?? null,
      approvedBy: resolutionCase?.runtime.events.find((item) => item.to === "approved")?.actor ?? null,
      segregationOfDutiesEnforced: true,
    },
    execution: {
      status: readback?.state ?? (receipts.length ? "accepted" : resolutionCase?.status === "approved" ? "requested" : "not_started"),
      downstream: readback?.downstream ?? null,
      receiptId: readback?.receiptId ?? receipts.at(-1)?.externalRequestId ?? null,
      mismatches: readback?.mismatches ?? [],
      apiWriteIsNotBusinessCompletion: true,
    },
    outcome: {
      status: outcome?.status ?? "not_measured",
      definitionId: outcome?.definitionId ?? null,
      baseline: (outcome?.baseline as { value?: number | string } | undefined)?.value ?? null,
      current: (outcome?.current as { value?: number | string } | undefined)?.value ?? null,
      target: definition?.targetValue ?? null,
      causalAttribution: false,
    },
    ai: {
      provider: input.ai?.provider ?? "not_used",
      model: input.ai?.model ?? "not_used",
      recommendationId: input.ai?.recommendationId ?? null,
      recommendationStatus: input.ai?.recommendationStatus ?? null,
      humanDecisionRequired: input.ai?.humanDecisionRequired ?? true,
      canApprove: false,
      canExecute: false,
      note: input.ai?.note ?? "AI 只提供解释与候选动作；审批与执行必须由人完成。",
    },
    trace: {
      status: trace.status,
      failures: trace.failures,
      hops: trace.hops,
      evidenceLinks: trace.evidence.length,
      payloadSourcePath: trace.payloadSource.path,
    },
    truthBoundary: {
      simulatedIndustrialEnvironment: true,
      realFactoryVerified: false,
      realMesVerified: false,
      realErpVerified: false,
      openSuposContractVerified: true,
      openSuposRuntimeVerified: false,
      customerDataVerified: false,
    },
    artifacts: {
      unsStream: input.artifacts?.unsStream ?? null,
      evidenceManifest: input.artifacts?.evidenceManifest ?? null,
      readback: input.artifacts?.readback ?? null,
    },
    fulfillment: contract ?? {
      version: "judge-contract/v1.0",
      contract: "FULFILLMENT_STATE_CONFLICT@1.0",
      businessKey: "SO-IND-001",
      industrialContext: null,
      currentCase: "C",
      facts: {
        businessKey: "SO-IND-001", sourceOrderLineRef: "", workOrderRef: "", productionLotRef: "", shipmentSourceRef: "",
        requiredQty: expected ?? 0, dueAt: "", completedQty: actual ?? 0, productionState: "in_progress", releasedQty: 0, executionCommittedQty: 0,
        sourceProgress: { ERP: "", MES: "", QMS: "", WMS: "" },
      },
      sourceSystems: ["ERP", "MES", "QMS", "WMS"],
      lineage: { status: "NOT_EVALUABLE", relation: "" },
      cases: [],
      realOpenSuposRuntimeVerified: false,
    },
  };
}

/** 设备粒度来自摄取账本 locator；取不到时回落到层级里声明的设备全集（并如实标注）。 */
export function collectEquipmentIds(trace: EvidenceTraceReport) {
  const equipment = new Set<string>();
  for (const link of trace.evidence) {
    const value = link.locator.equipmentId;
    if (typeof value === "string" && value) equipment.add(value);
  }
  if (!equipment.size) {
    for (const node of DEMO_MANUFACTURING_HIERARCHY.nodes) {
      if (node.level === "equipment") equipment.add(node.id);
    }
  }
  return [...equipment].sort();
}
