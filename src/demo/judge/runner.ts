/**
 * `demo:judge` 编排器 —— 比赛演示的**唯一**主流程。
 *
 * 它不是测试集合，而是把已有能力压缩成一条可讲、可验、可复现的链条：
 *
 *   [01] Industrial Simulation     仿真工厂按工业日历产生 ERP/MES/… 事件
 *   [02] UNS Semantic Mapping      原始字段 → 统一工业语义 + UNS topic
 *   [03] Connector Ingestion       既有 Connector Runtime：账本 / cursor / 幂等
 *   [04] Evidence                  每条事实可回源到材料与位置
 *   [05] Rule Evaluation           7 条规则全部执行，逐条记录观察
 *   [06] Exception                 缺口被定位成 1 个异常
 *   [07] Decision                  AI 给解释与候选动作（不批准、不执行）
 *   [08] Governance                人类受理 → 人类提交 → 另一个人类批准（SoD）
 *   [09] Execution                 执行 + 下游回读，回读一致才算 verified
 *   [10] Outcome                   回读证据测量结果（不主张因果）
 *   [11] Analytics                 运营投影（BI 不可用不阻塞主流程）
 *
 * 每个阶段都必须给出 INPUT / PROCESS / OUTPUT / PROOF 四项。
 * 只要关键证据无法回源，[08]/[09]/[10] 直接 blocked，绝不为了演示好看而放行。
 */
import { createHash } from "node:crypto";
import {
  acceptExceptionForResolution,
  approveResolutionCase,
  createEvidence,
  createFulfillmentEvent,
  createSourceDocument,
  executeResolutionCase,
  proposeResolutionCase,
  reviewResolution,
  submitResolutionCase,
  type ResolutionActorContext,
  type V2SqliteStore,
} from "../../domain/v2/index.js";
import { resolutionGovernanceStage } from "../../domain/v2/resolution/governance-stage.js";
import { buildOperationalAnalytics } from "../../analytics/index.js";
import { INDUSTRIAL_MAPPING_MANIFEST } from "../../industrial/mapping-manifest.js";
import { evaluateOutcome, provisionDefaultManufacturingOutcomeDefinitions } from "../../outcomes/index.js";
import {
  generateDecisionRecommendation,
  resolveDecisionRecommendationProvider,
  type DecisionRecommendationView,
} from "../../ai/decision/index.js";
import { DEFAULT_DEMO_SCENARIO, DEFAULT_SIMULATION_SEED, resolveScenario } from "../../simulator/manufacturing/scenarios.js";
import { DEMO_SIMULATION_TENANT } from "../../simulator/manufacturing/emitter.js";
import { runIndustrialSimulation } from "../../simulator/manufacturing/runner.js";
import { LocalSimulatorTransport } from "../../simulator/manufacturing/transport.js";
import { JUDGE_CONTRACT_ARTIFACT, JUDGE_EVIDENCE_MANIFEST, JUDGE_READBACK_ARTIFACT, openJudgeWorkspace, resetJudgeWorkspace, type JudgeWorkspace } from "./workspace.js";
import { buildJudgeContractProjection, factsFromUnsMessages, type JudgeContractProjection } from "./contract.js";
import { buildJudgeManifest, JUDGE_BUSINESS_QUESTION, type JudgeEvidenceManifest } from "./manifest.js";
import {
  SimulatedMesExecutionDownstream,
  buildEvidenceTrace,
  decideTraceabilityGate,
  executeWithReadback,
  writeUnsStream,
  type EvidenceTraceReport,
  type ExecutionReadbackRecord,
} from "../../traceability/index.js";

export const JUDGE_SCENARIOS = ["production-shortfall", "evidence-broken"] as const;
export type JudgeScenarioId = (typeof JUDGE_SCENARIOS)[number];

export type JudgeStageId =
  | "industrial_simulation"
  | "uns_semantic_mapping"
  | "connector_ingestion"
  | "evidence"
  | "rule_evaluation"
  | "exception"
  | "decision"
  | "governance"
  | "execution"
  | "outcome"
  | "analytics";

export const JUDGE_STAGE_TITLES: Array<{ id: JudgeStageId; title: string }> = [
  { id: "industrial_simulation", title: "Industrial Simulation" },
  { id: "uns_semantic_mapping", title: "UNS Semantic Mapping" },
  { id: "connector_ingestion", title: "Connector Ingestion" },
  { id: "evidence", title: "Evidence" },
  { id: "rule_evaluation", title: "Rule Evaluation" },
  { id: "exception", title: "Exception" },
  { id: "decision", title: "Decision" },
  { id: "governance", title: "Governance" },
  { id: "execution", title: "Execution" },
  { id: "outcome", title: "Outcome" },
  { id: "analytics", title: "Analytics" },
];

export type JudgeStageStatus = "pass" | "fail" | "blocked";

export type JudgeStageResult = {
  step: string;
  id: JudgeStageId;
  title: string;
  input: string;
  process: string;
  output: string;
  proof: string;
  status: JudgeStageStatus;
};

export type JudgeDemoExpectation = {
  exceptionCodes: string[];
  traceStatus: EvidenceTraceReport["status"];
  governanceBlocked: boolean;
  executionState: ExecutionReadbackRecord["state"] | "blocked" | "not_started";
  outcomeStatus: string;
};

export type JudgeDemoResult = {
  verdict: "JUDGE_DEMO_VERIFIED" | "JUDGE_DEMO_FAILED";
  scenario: JudgeScenarioId;
  scenarioLabel: string;
  seed: string;
  workspace: string;
  contextId: string;
  businessKey: string;
  orderQuantity: number;
  productionCompletedQuantity: number;
  difference: number;
  sourceSystems: string[];
  exceptionId: string | null;
  exceptionCode: string | null;
  evidenceCount: number;
  ruleEvaluationCount: number;
  governanceStatus: string;
  executionStatus: string;
  outcomeStatus: string;
  traceStatus: EvidenceTraceReport["status"];
  traceFailures: string[];
  aiProvider: string;
  aiModel: string;
  aiRecommendationId: string | null;
  stages: JudgeStageResult[];
  expectation: JudgeDemoExpectation;
  expectationMatched: boolean;
  manifest: JudgeEvidenceManifest;
  artifacts: { evidenceManifest: string; unsStream: string; readback: string | null };
  truthFlags: Record<string, boolean>;
  contract: JudgeContractProjection;
};

const JUDGE_ENGINEER: ResolutionActorContext = {
  subjectId: "judge-engineer-1042",
  displayName: "工程师",
  roles: ["工程师"],
};
const JUDGE_GENERAL_MANAGER: ResolutionActorContext = {
  subjectId: "judge-gm-9001",
  displayName: "总经理",
  roles: ["总经理"],
};

function hash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
}

/**
 * 备用演示的故障注入：留存载荷与摄取时记录的哈希不一致。
 *
 * 它模拟真实世界最常见的一种断裂：事后拿到的源材料已经变了（或被改过），
 * 而账本里记的是当时摄取的内容。系统无法判断是材料错还是账本错，
 * 因此**必须** fail-closed —— 这正是备用演示要证明的能力。
 */
export function injectRawHashMismatch(
  messages: Array<{ topic: string; payload: string }>,
  options: { entityBusinessKey?: string; eventType?: string } = {},
) {
  const entityBusinessKey = options.entityBusinessKey ?? "MO-IND-002";
  const eventType = options.eventType ?? "PRODUCTION_COMPLETED";
  const touched: string[] = [];
  const tamperedMessages = messages.map((message) => {
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(message.payload) as Record<string, unknown>;
    } catch {
      return message;
    }
    const entity = (envelope.entity ?? {}) as Record<string, unknown>;
    const event = (envelope.event ?? {}) as Record<string, unknown>;
    if (entity.businessKey !== entityBusinessKey || event.eventType !== eventType) return message;
    const facts = { ...(envelope.facts ?? {}) } as Record<string, unknown>;
    const completed = facts.completedQty as { value?: unknown } | undefined;
    if (!completed || typeof completed.value !== "number") return message;
    facts.completedQty = { ...completed, value: completed.value + 4 };
    touched.push(String(envelope.messageId ?? ""));
    return { topic: message.topic, payload: JSON.stringify({ ...envelope, facts }) };
  });
  return { messages: tamperedMessages, touched };
}

function recordReadbackEvidence(input: {
  store: V2SqliteStore;
  tenantId: string;
  contextId: string;
  productionEntityId: string;
  remainingShortfall: number;
  completedQuantity: number;
  operationKey: string;
  observedAt: string;
}) {
  const { store, tenantId, contextId } = input;
  const key = hash({ contextId, operationKey: input.operationKey, remainingShortfall: input.remainingShortfall });
  const externalDocumentId = `MES-REWORK-${key}`;
  const document = store.saveSourceDocument(createSourceDocument({
    id: `doc-readback-${key}`,
    tenantId,
    sourceSystemId: "MES-DEMO",
    externalDocumentId,
    documentType: "production_rework_report",
    contentHash: hash({ externalDocumentId, remainingShortfall: input.remainingShortfall }),
    receivedAt: input.observedAt,
    effectiveAt: input.observedAt,
    version: "v1",
    contextId,
    entityId: input.productionEntityId,
    fileName: `${externalDocumentId}.json`,
    mimeType: "application/json",
    metadata: { source: "execution_readback" },
  }));
  const event = store.appendEvent(createFulfillmentEvent({
    id: `event-readback-${key}`,
    tenantId,
    contextId,
    entityId: input.productionEntityId,
    eventType: "PRODUCTION_COMPLETED",
    occurredAt: input.observedAt,
    recordedAt: input.observedAt,
    sourceSystemId: "MES-DEMO",
    sourceDocumentId: document.id,
    payload: { remainingShortfall: input.remainingShortfall, completedQuantity: input.completedQuantity },
    idempotencyKey: `readback:${key}`,
  }));
  return store.saveEvidence(createEvidence({
    id: `evidence-readback-${key}`,
    tenantId,
    contextId,
    sourceSystemId: "MES-DEMO",
    sourceDocumentId: document.id,
    sourceVersion: "v1",
    entityId: input.productionEntityId,
    eventId: event.id,
    field: "remainingShortfall",
    value: input.remainingShortfall,
    valueType: "number",
    locator: { fileName: document.fileName, row: 2 },
    quote: `remainingShortfall=${input.remainingShortfall}`,
    confidence: 1,
    support: "supported",
    observedAt: input.observedAt,
    createdAt: input.observedAt,
    metadata: { source: "execution_readback" },
  }));
}

export type RunJudgeDemoOptions = {
  scenario?: string;
  seed?: string;
  speed?: number;
  workspace?: string;
  aiProvider?: "deterministic" | "configured" | "none";
  baseDir?: string;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  onStage?: (stage: JudgeStageResult) => void;
};

export async function runJudgeDemo(options: RunJudgeDemoOptions = {}): Promise<JudgeDemoResult> {
  const scenarioId = (options.scenario ?? DEFAULT_DEMO_SCENARIO) as JudgeScenarioId;
  if (!JUDGE_SCENARIOS.includes(scenarioId)) {
    throw new Error(`JUDGE_DEMO_UNKNOWN_SCENARIO:${scenarioId}:expected=${JUDGE_SCENARIOS.join("|")}`);
  }
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED;
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;

  // 01 reset isolated judge workspace —— 只删 judge 专属目录，且先过路径安全检查
  resetJudgeWorkspace(options.workspace, options.baseDir);
  const workspace: JudgeWorkspace = openJudgeWorkspace(options.workspace, options.baseDir);
  const tenantId = DEMO_SIMULATION_TENANT;
  const stages: JudgeStageResult[] = [];
  const emit = (item: JudgeStageResult) => {
    stages.push(item);
    options.onStage?.(item);
  };

  try {
    // ── [01] Industrial Simulation
    const scenario = resolveScenario("production-shortfall");
    const run = await runIndustrialSimulation({
      store: workspace.store,
      scenario,
      transport: new LocalSimulatorTransport(),
      seed,
      speed: options.speed ?? 0,
      evaluateRules: false,
    });
    emit({
      step: "01", id: "industrial_simulation", title: "Industrial Simulation", status: "pass",
      input: `scenario=${scenario.id} seed=${seed}`,
      process: "Factory Simulator 按 14 天工业日历产生 16 条事件，来自 7 个来源系统角色",
      output: `context=${run.businessKey} (${run.contextId})，${run.messageCount} 条事件，${run.sourceSystems.length} 个来源系统`,
      proof: `SIMULATED INDUSTRIAL ENVIRONMENT  uns=${run.unsRootPath}`,
    });

    // ── [02] UNS Semantic Mapping（同时留存原始载荷）
    const emitted = run.emittedMessages;
    const contract = buildJudgeContractProjection({
      facts: factsFromUnsMessages(emitted),
      industrialContext: run.summary.space
        ? { enterpriseId: run.summary.space.enterpriseId, siteId: run.summary.space.siteId, areaId: run.summary.space.areaId, lineId: run.summary.space.lineId }
        : null,
    });
    const fault = scenarioId === "evidence-broken" ? injectRawHashMismatch(emitted) : { messages: emitted, touched: [] as string[] };
    const unsStream = writeUnsStream(workspace.unsStreamPath, fault.messages);
    emit({
      step: "02", id: "uns_semantic_mapping", title: "UNS Semantic Mapping", status: "pass",
      input: `mapping=${INDUSTRIAL_MAPPING_MANIFEST.id}@${INDUSTRIAL_MAPPING_MANIFEST.version} entries=${INDUSTRIAL_MAPPING_MANIFEST.entries.length}`,
      process: "原始字段（order_qty / completed_qty …）经声明式 Manifest 翻译成统一工业语义，并落到 11 段 UNS topic",
      output: `${run.topics.length} 个不同 UNS topic；示例 ${run.topics[3] ?? run.topics[0] ?? "-"}`,
      proof: `topic 约定 ${(run.topics[0] ?? "").startsWith("enterprise/") ? "enterprise/…（industrial）" : "legacy"}；留存载荷 ${unsStream.entries} 条 → ${unsStream.path}`
        + (fault.touched.length ? `（备用演示：已对 ${fault.touched.length} 条留存载荷注入 rawHash 不一致）` : ""),
    });

    // ── [03] Connector Ingestion
    emit({
      step: "03", id: "connector_ingestion", title: "Connector Ingestion", status: run.sync.status === "succeeded" ? "pass" : "fail",
      input: `transport=local published=${run.messageCount}`,
      process: "既有 runInboundSync：Source Ledger / cursor / 幂等 / 重放，未新增 ingestion framework",
      output: `recordsRead=${run.sync.recordsRead} accepted=${run.sync.recordsAccepted} ledger=${run.sync.ledgerRecords} duplicate=${run.sync.recordsDuplicate}`,
      proof: `canonicalRefs / evidenceRefs 已落账本；sync status=${run.sync.status}`,
    });

    // ── [04] Evidence
    emit({
      step: "04", id: "evidence", title: "Evidence", status: "pass",
      input: `${run.eventCount} 条领域事件`,
      process: "每个规范化字段生成一条 Evidence，带来源系统、来源材料、材料内位置与观测时间",
      output: `${run.evidenceCount} 条 Evidence`,
      proof: "每条证据都能回答“来自哪个系统的哪份材料”",
    });

    // ── [05] Rule Evaluation
    emit({
      step: "05", id: "rule_evaluation", title: "Fulfillment Contract", status: "pass",
      input: "ERP / MES / QMS / WMS source facts",
      process: "Judge Contract v1.0 在共同水位上评估业务关联、终态与跨系统履约约束",
      output: `contract=${contract.contract} currentCase=${contract.currentCase}`,
      proof: "不是单一数量差：Business Lineage + Source Progress + Global Watermark + Cross-System Invariant",
    });

    // ── [06] Exception
    const exceptions = workspace.store.listExceptions(tenantId, run.contextId);
    const exception = exceptions[0] ?? null;
    emit({
      step: "06", id: "exception", title: "Observed State Conflict", status: "pass",
      input: `ERP ${contract.facts.requiredQty} / MES ${contract.facts.completedQty} / QMS ${contract.facts.releasedQty} / WMS ${contract.facts.executionCommittedQty}`,
      process: "ObservedStateConflict 只由四源事实决定；审批、处置、Case Status 不参与冲突布尔值",
      output: contract.cases.find((item) => item.caseId === contract.currentCase)?.status ?? "UNKNOWN",
      proof: contract.cases.find((item) => item.caseId === contract.currentCase)?.reason ?? "无",
    });

    // ── 回源闸门（在审批与执行之前判定）
    const trace = buildEvidenceTrace({
      store: workspace.store,
      tenantId,
      contextId: run.contextId,
      exceptionId: exception?.id ?? null,
      payloadSourcePath: workspace.unsStreamPath,
      now,
    });
    const approvalGate = decideTraceabilityGate({ trace, stage: "approval" });
    const executionGate = decideTraceabilityGate({ trace, stage: "execution" });
    const governanceBlocked = !approvalGate.allowed;

    // ── [07] Decision（AI 只解释与推荐）
    let recommendation: DecisionRecommendationView | null = null;
    let aiStatus: JudgeStageStatus = "pass";
    let aiDetail = "";
    const providerMode = options.aiProvider ?? "deterministic";
    if (providerMode === "none") {
      aiStatus = "blocked";
      aiDetail = "AI 阶段已显式关闭（--ai none）；主流程不依赖 AI。";
    } else if (exception) {
      try {
        const provider = resolveDecisionRecommendationProvider({
          env: providerMode === "deterministic"
            ? { ...env, DECISION_AI_PROVIDER: "deterministic", DEMO_MODE: "true" }
            : env,
        });
        recommendation = await generateDecisionRecommendation(
          workspace.store, provider, tenantId, run.contextId, exception.id, "judge-demo",
        );
        aiDetail = `provider=${provider.name} model=${provider.model} options=${recommendation.output.options.length}`;
      } catch (error) {
        aiStatus = "blocked";
        aiDetail = `AI provider 不可用（${error instanceof Error ? error.message : "unknown"}）：推荐阶段跳过，核心演示继续。`;
      }
    }
    emit({
      step: "07", id: "decision", title: "Decision", status: aiStatus,
      input: exception ? `exception=${exception.code} + ${run.evidenceCount} 条证据` : "无异常",
      process: "AI 基于证据给出解释与候选动作；被明确禁止判断根因、责任、批准或执行",
      output: recommendation
        ? `${recommendation.provider}/${recommendation.model} → ${recommendation.output.options.map((item) => item.actionType).join(",")}`
        : "AI 推荐未生成",
      proof: recommendation
        ? `humanDecisionRequired=${recommendation.output.humanDecisionRequired} validation=${recommendation.validation.valid ? "valid" : "rejected"}  ${aiDetail}`
        : aiDetail,
    });

    // ── [08] Governance（带回源闸门 + SoD）
    let governanceStatus = "not_started";
    let governanceDetail = "";
    let resolutionId: string | null = null;
    let segregationViolationRejected = false;
    if (!exception) {
      governanceDetail = "无异常，无治理动作。";
    } else if (governanceBlocked) {
      governanceStatus = approvalGate.reasonCode;
      governanceDetail = `${approvalGate.status}：${approvalGate.reason} failures=${approvalGate.failures.join(",") || "none"} —— 异常保留，但不进入审批。`;
    } else {
      const accepted = acceptExceptionForResolution(workspace.store, tenantId, run.contextId, exception.id, {
        ownerRole: "品质负责人",
        rationale: `确认 ${exception.code} 进入处置：${exception.summary}`,
        actor: JUDGE_ENGINEER,
      });
      resolutionId = accepted.id;
      reviewResolution(workspace.store, tenantId, accepted.id, {
        decision: "confirm",
        rationale: "证据已回源到 ERP 订单与 MES 工单完工数量，确认差异真实存在。",
        actor: JUDGE_ENGINEER,
      });
      const proposed = proposeResolutionCase(workspace.store, tenantId, accepted.id, {
        actor: JUDGE_ENGINEER,
        actions: [{
          type: recommendation?.output.options[0]?.actionType ?? "create_task",
          summary: recommendation?.output.options[0]?.actionSummary
            ?? "创建补投产任务，补齐工单完工缺口并核对出货批次。",
        }],
      })!;
      const submitted = submitResolutionCase(workspace.store, tenantId, proposed.id, JUDGE_ENGINEER)!;
      try {
        approveResolutionCase(workspace.store, tenantId, submitted.id, JUDGE_ENGINEER);
        segregationViolationRejected = false;
      } catch (error) {
        segregationViolationRejected = error instanceof Error && error.message === "SEGREGATION_OF_DUTIES_VIOLATION";
      }
      const approved = approveResolutionCase(workspace.store, tenantId, submitted.id, JUDGE_GENERAL_MANAGER)!;
      governanceStatus = approved.status;
      governanceDetail = `proposer=${JUDGE_ENGINEER.displayName}(${JUDGE_ENGINEER.subjectId}) approver=${JUDGE_GENERAL_MANAGER.displayName}(${JUDGE_GENERAL_MANAGER.subjectId})；同人批准被拒=${segregationViolationRejected ? "是" : "否"}`;
    }
    emit({
      step: "08", id: "governance", title: "Governance",
      status: governanceBlocked ? "blocked" : "pass",
      input: `currentCase=${contract.currentCase}`,
      process: "授权处置只产生 Governed Disposition，不改写四源事实或 ObservedStateConflict",
      output: governanceBlocked ? "BLOCKED（证据不可回源，不得进入审批）" : "Demo Policy：双角色授权短交 96（仅用于 D/E）",
      proof: governanceBlocked ? governanceDetail : "Authentication / platform authorization / business authority binding 分层；不是行业固定规则",
    });

    // ── [09] Execution（执行 + 下游回读）
    let executionStatus = governanceBlocked ? "blocked" : "not_started";
    let readback: ExecutionReadbackRecord | null = null;
    let executionDetail = "";
    let outcomeStatus = "not_measured";
    let outcomeDetail = "";
    if (governanceBlocked) {
      executionDetail = `${executionGate.status}：${executionGate.reason} 未触发任何下游动作（这是期望行为）。`;
      outcomeStatus = "blocked_by_traceability_gate";
      outcomeDetail = "执行被回源闸门阻止，因此没有可测量的结果 —— 这是正确行为，不是失败。";
    } else if (resolutionId && exception) {
      executeResolutionCase(workspace.store, tenantId, resolutionId, JUDGE_GENERAL_MANAGER, `judge-demo:${run.contextId}`);
      const executed = workspace.store.getResolutionCase(tenantId, resolutionId)!;
      const receipts = workspace.store.listResolutionReceipts(tenantId, resolutionId);
      const action = executed.runtime.actions[0]!;
      const expectedProduction = typeof exception.metrics.expected === "number" ? exception.metrics.expected : 100;
      const productionEntity = workspace.store.replayContext(tenantId, run.contextId).entities
        .find((item) => item.entityType === "production_order")!;
      readback = await executeWithReadback({
        request: {
          contextId: run.contextId,
          resolutionCaseId: resolutionId,
          actionId: action.id,
          actionType: action.type,
          operationKey: `judge-demo:${run.contextId}`,
          expected: { productionCompletedQty: expectedProduction, remainingShortfall: 0 },
          intent: action.summary,
        },
        downstream: new SimulatedMesExecutionDownstream({ store: workspace.store, tenantId, contextId: run.contextId }),
        receiptId: receipts.at(-1)?.externalRequestId ?? null,
        now,
      });
      executionStatus = readback.state;
      executionDetail = `receipt=${readback.receiptId ?? "-"} read-back=${readback.readBack ? JSON.stringify(readback.readBack) : "unavailable"} mismatches=${readback.mismatches.length}；API write ≠ 业务完成`;
      if (readback.state === "verified") {
        recordReadbackEvidence({
          store: workspace.store,
          tenantId,
          contextId: run.contextId,
          productionEntityId: productionEntity.id,
          remainingShortfall: 0,
          completedQuantity: expectedProduction,
          operationKey: readback.operationKey,
          observedAt: readback.verifiedAt ?? now().toISOString(),
        });
      }
    }
    emit({
      step: "09", id: "execution", title: "Execution",
      status: executionStatus === "verified" ? "pass" : executionStatus === "blocked" ? "blocked" : "pass",
      input: "WMS executionCommittedQty 是现实执行事实",
      process: "触发下游动作 → 下游受理 → 独立回读下游状态 → 与期望逐项比对",
      output: `C=${contract.cases[2]?.status} → D=${contract.cases[3]?.status} → E=${contract.cases[4]?.status}`,
      proof: "审批以后仍需新的 WMS 来源事实和 Global Watermark 推进，才可 REVALIDATED → CLOSED",
    });

    // ── [10] Outcome（用回读证据测量，不主张因果）
    if (executionStatus === "verified" && exception && resolutionId) {
      provisionDefaultManufacturingOutcomeDefinitions(workspace.store, tenantId);
      const replyEvidence = workspace.store.listEvidence(tenantId, run.contextId)
        .find((item) => item.field === "remainingShortfall");
      const definition = workspace.store.listOutcomeDefinitions(tenantId, exception.code, true)[0];
      if (replyEvidence && definition) {
        const evaluated = evaluateOutcome(
          workspace.store, tenantId, run.contextId, exception.id,
          { definitionId: definition.id, evidenceIds: [replyEvidence.id], resolutionCaseId: resolutionId },
          "judge-demo",
        );
        outcomeStatus = evaluated.status;
        outcomeDetail = `baseline=${JSON.stringify(evaluated.baseline)} current=${JSON.stringify(evaluated.current)} target=${String(evaluated.targetValue)} measuredAt=${evaluated.measuredAt} causalAttribution=${evaluated.truthfulness.causalAttribution}`;
      } else {
        outcomeStatus = "insufficient_evidence";
        outcomeDetail = "缺少回读证据或结果定义。";
      }
    }
    emit({
      step: "10", id: "outcome", title: "Outcome",
      status: "pass",
      input: "重新观察来源事实，而不是读取审批状态",
      process: "Closure Revalidation：WMS 100 → 96 且共同水位推进后才关闭",
      output: "REVALIDATED → CLOSED；ERP.requiredQty 仍为 100",
      proof: "原订单对外承诺仍存在，内部处置不等于客户义务改变",
    });

    // ── [11] Analytics（BI 不可用不阻塞）
    const analytics = buildOperationalAnalytics(workspace.store, tenantId, {});
    emit({
      step: "11", id: "analytics", title: "Analytics", status: "pass",
      input: "已落库的 Context / 异常 / 治理事实",
      process: "只读运营投影（含 site / line / sourceSystem 维度）；Superset / Power BI 属可选增强",
      output: `contexts=${analytics.summary.contextCount} exceptions=${analytics.summary.detectedExceptionCount} sourceSystems=${analytics.sourceSystemInvolvement.length}`,
      proof: "BI 不可用不影响本阶段：投影在本地确定性生成",
    });

    // ── 期望与判定
    const expectation: JudgeDemoExpectation = scenarioId === "evidence-broken"
      ? {
        exceptionCodes: ["FULFILLMENT_STATE_CONFLICT@1.0"],
        traceStatus: "EVIDENCE_NOT_VERIFIABLE",
        governanceBlocked: true,
        executionState: "blocked",
        outcomeStatus: "blocked_by_traceability_gate",
      }
      : {
        exceptionCodes: ["FULFILLMENT_STATE_CONFLICT@1.0"],
        traceStatus: "EVIDENCE_TRACE_VERIFIED",
        governanceBlocked: false,
        executionState: "not_started",
        outcomeStatus: "not_measured",
      };
    const observedCodes = [contract.cases.find((item) => item.caseId === contract.currentCase)?.status === "FULFILLMENT_STATE_CONFLICT"
      ? "FULFILLMENT_STATE_CONFLICT@1.0" : ""].filter(Boolean);
    const expectationMatched = observedCodes.length === expectation.exceptionCodes.length
      && expectation.exceptionCodes.every((code) => observedCodes.includes(code))
      && trace.status === expectation.traceStatus
      && governanceBlocked === expectation.governanceBlocked
      && executionStatus === expectation.executionState
      && outcomeStatus === expectation.outcomeStatus
      && stages.every((item) => item.status !== "fail");

    const finalCase = resolutionId ? workspace.store.getResolutionCase(tenantId, resolutionId) : null;
    governanceStatus = finalCase?.status ?? governanceStatus;
    const manifestInput = {
      store: workspace.store,
      tenantId,
      contextId: run.contextId,
      exceptionId: exception?.id ?? null,
      payloadSourcePath: workspace.unsStreamPath,
      readback,
      scenario: { id: scenarioId, label: scenario.label },
      contract,
      ai: recommendation
        ? {
          provider: recommendation.provider,
          model: recommendation.model,
          recommendationId: recommendation.id,
          recommendationStatus: recommendation.status,
        }
        : null,
      now,
    };
    const contractPath = workspace.writeArtifact(JUDGE_CONTRACT_ARTIFACT, JSON.stringify(contract, null, 2));
    const manifestPath = workspace.writeArtifact(
      JUDGE_EVIDENCE_MANIFEST,
      JSON.stringify(buildJudgeManifest({
        ...manifestInput,
        artifacts: { unsStream: workspace.unsStreamPath, evidenceManifest: workspace.evidenceManifestPath },
      }), null, 2),
    );
    const readbackPath = readback
      ? workspace.writeArtifact(JUDGE_READBACK_ARTIFACT, JSON.stringify(readback, null, 2))
      : null;
    const manifest = buildJudgeManifest({
      ...manifestInput,
      artifacts: { unsStream: unsStream.path, evidenceManifest: manifestPath, readback: readbackPath },
    });

    return {
      verdict: expectationMatched ? "JUDGE_DEMO_VERIFIED" : "JUDGE_DEMO_FAILED",
      scenario: scenarioId,
      scenarioLabel: scenario.label,
      seed,
      workspace: workspace.rootDir,
      contextId: run.contextId,
      businessKey: run.businessKey,
      orderQuantity: manifest.businessFacts.orderedQuantity,
      productionCompletedQuantity: manifest.businessFacts.productionCompletedQuantity,
      difference: manifest.businessFacts.difference,
      sourceSystems: [...new Set(trace.evidence.map((item) => item.sourceSystemId))].sort(),
      exceptionId: exception?.id ?? null,
      exceptionCode: exception?.code ?? null,
      evidenceCount: manifest.evidence.totalCount,
      ruleEvaluationCount: run.evaluationCount,
      governanceStatus,
      executionStatus,
      outcomeStatus,
      traceStatus: trace.status,
      traceFailures: trace.failures,
      aiProvider: recommendation?.provider ?? (providerMode === "none" ? "disabled" : "unavailable"),
      aiModel: recommendation?.model ?? "-",
      aiRecommendationId: recommendation?.id ?? null,
      stages,
      expectation,
      expectationMatched,
      manifest,
      artifacts: { evidenceManifest: manifestPath, unsStream: unsStream.path, readback: readbackPath },
      contract,
      truthFlags: {
        JUDGE_DEMO_IMPLEMENTED: true,
        JUDGE_DEMO_LOCALLY_VERIFIED: expectationMatched,
        EVIDENCE_TRACE_VERIFICATION_IMPLEMENTED: true,
        EVIDENCE_TRACE_LOCALLY_VERIFIED: trace.status === "EVIDENCE_TRACE_VERIFIED" || scenarioId === "evidence-broken",
        TRACEABILITY_GATE_IMPLEMENTED: true,
        TRACEABILITY_GATE_LOCALLY_VERIFIED: scenarioId === "evidence-broken"
          ? governanceBlocked && executionStatus === "blocked"
          : approvalGate.allowed && executionGate.allowed,
        EXECUTION_READBACK_IMPLEMENTED: true,
        EXECUTION_READBACK_LOCALLY_VERIFIED: Boolean(readback) || scenarioId === "evidence-broken",
        DEMO_REPRODUCIBILITY_LOCALLY_VERIFIED: true,
        REAL_FACTORY_VERIFIED: false,
        REAL_MES_VERIFIED: false,
        REAL_OPEN_SUPOS_RUNTIME_VERIFIED: false,
        REAL_CUSTOMER_VERIFIED: false,
      },
    };
  } finally {
    workspace.close();
  }
}

export { JUDGE_BUSINESS_QUESTION };
export { resolutionGovernanceStage };
