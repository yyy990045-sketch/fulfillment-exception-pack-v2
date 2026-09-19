import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../domain/v2/index.js";
import type {
  AutomationReceiptRecord,
  AutomationRunRecord,
  InternalWorkItemRecord,
} from "../domain/v2/automation-types.js";
import { getPolicyEvaluation } from "../policy/index.js";
import { buildAutomationReadiness } from "./readiness.js";
import { resolveAutomationExecutor } from "./registry.js";
import { AutomationError, type AutomationExecutor, type AutomationRunView, type AutomationTriggerSource } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function operationKey(input: { tenantId: string; policyEvaluationId: string; actionType: string; executorVersion: string }) {
  return hash(input);
}

function toView(store: V2SqliteStore, run: AutomationRunRecord): AutomationRunView {
  return {
    run,
    ...(run.receiptId ? { receipt: store.getAutomationReceipt(run.tenantId, run.receiptId) } : {}),
    ...(run.effectId ? { workItem: store.getInternalWorkItem(run.tenantId, run.effectId) } : {}),
  };
}

function firstBlockedCode(readiness: ReturnType<typeof buildAutomationReadiness>) {
  const code = readiness.reasons[0];
  if (!code) return "AUTOMATION_NOT_READY";
  return code;
}

export function executePolicyAutomation(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  policyEvaluationId: string,
  actor: string,
  triggerSource: AutomationTriggerSource = "human_request",
  options: { env?: Record<string, string | undefined>; executor?: AutomationExecutor } = {},
): AutomationRunView {
  if (!actor.trim()) throw new AutomationError("actor_required", 401);
  const executionExecutor = resolveAutomationExecutor(options);
  const evaluation = getPolicyEvaluation(store, tenantId, contextId, exceptionId, policyEvaluationId);
  if (!evaluation) throw new AutomationError("AUTOMATION_POLICY_EVALUATION_NOT_FOUND", 404);
  const readiness = buildAutomationReadiness(store, tenantId, contextId, exceptionId, policyEvaluationId, options);
  if (!readiness.executable) {
    const code = firstBlockedCode(readiness);
    const status = code === "AUTOMATION_DISABLED" || code === "AUTOMATION_EXECUTOR_NOT_CONFIGURED" ? 503 : 409;
    throw new AutomationError(code, status);
  }
  const key = operationKey({
    tenantId,
    policyEvaluationId,
    actionType: evaluation.candidateActionType,
    executorVersion: executionExecutor.version,
  });
  const existing = store.getAutomationRunByOperationKey(tenantId, key);
  if (existing) return toView(store, existing);
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception) throw new AutomationError("AUTOMATION_EXCEPTION_NOT_FOUND", 404);
  const createdAt = new Date().toISOString();
  const runId = `arun-${key.slice(0, 24)}`;
  const effectId = `iwi-${key.slice(0, 24)}`;
  const receiptId = `arec-${key.slice(0, 24)}`;
  let effect;
  try {
    effect = executionExecutor.execute({
      tenantId,
      contextId,
      exceptionId,
      exceptionTitle: exception.title,
      policyEvaluation: evaluation,
      actionType: evaluation.candidateActionType,
    });
  } catch {
    const failedRun: AutomationRunRecord = {
      tenantId,
      id: runId,
      contextId,
      exceptionId,
      policyEvaluationId,
      candidateActionType: evaluation.candidateActionType,
      ...(evaluation.sourceRecommendationId ? { sourceRecommendationId: evaluation.sourceRecommendationId } : {}),
      ...(evaluation.sourceOptionId ? { sourceOptionId: evaluation.sourceOptionId } : {}),
      executor: executionExecutor.name,
      executorVersion: executionExecutor.version,
      operationKey: key,
      status: "failed",
      triggerSource,
      triggeredBy: actor,
      createdAt,
      completedAt: createdAt,
    };
    return toView(store, store.transaction(() => store.saveAutomationRun(failedRun)));
  }
  return store.transaction(() => {
    const raced = store.getAutomationRunByOperationKey(tenantId, key);
    if (raced) return toView(store, raced);
    const workItem: InternalWorkItemRecord = {
      tenantId,
      id: effectId,
      contextId,
      exceptionId,
      kind: effect.kind,
      source: "policy_automation",
      actionType: evaluation.candidateActionType,
      title: effect.title,
      description: effect.description,
      status: "open",
      createdBy: actor,
      createdAt,
      metadata: { ...effect.metadata, operationKey: key },
    };
    const payloadHash = hash({
      tenantId,
      policyEvaluationId,
      actionType: evaluation.candidateActionType,
      effect,
    });
    const receipt: AutomationReceiptRecord = {
      tenantId,
      id: receiptId,
      automationRunId: runId,
      effectId,
      receiptSource: "internal-work-item",
      status: "succeeded",
      payloadHash,
      createdAt,
    };
    const run: AutomationRunRecord = {
      tenantId,
      id: runId,
      contextId,
      exceptionId,
      policyEvaluationId,
      candidateActionType: evaluation.candidateActionType,
      ...(evaluation.sourceRecommendationId ? { sourceRecommendationId: evaluation.sourceRecommendationId } : {}),
      ...(evaluation.sourceOptionId ? { sourceOptionId: evaluation.sourceOptionId } : {}),
      executor: executionExecutor.name,
      executorVersion: executionExecutor.version,
      operationKey: key,
      status: "succeeded",
      effectId,
      receiptId,
      triggerSource,
      triggeredBy: actor,
      createdAt,
      completedAt: createdAt,
    };
    store.saveAutomationRun(run);
    store.saveInternalWorkItem(workItem);
    store.saveAutomationReceipt(receipt);
    return toView(store, store.getAutomationRun(tenantId, runId) ?? run);
  });
}

export function listAutomationRuns(store: V2SqliteStore, tenantId: string, contextId: string, exceptionId: string) {
  return store.listAutomationRuns(tenantId, contextId, exceptionId).map((run) => toView(store, run));
}

export function getAutomationRun(store: V2SqliteStore, tenantId: string, contextId: string, exceptionId: string, runId: string) {
  const run = store.getAutomationRun(tenantId, runId);
  if (!run || run.contextId !== contextId || run.exceptionId !== exceptionId) return undefined;
  return toView(store, run);
}
