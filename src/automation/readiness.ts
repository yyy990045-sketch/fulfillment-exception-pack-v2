import type { V2SqliteStore } from "../domain/v2/index.js";
import { getPolicyActionMetadata } from "../policy/action-catalog.js";
import { getPolicyEvaluation, type PolicyEvaluationView } from "../policy/index.js";
import { automationRuntimeConfig, resolveAutomationExecutor } from "./registry.js";
import { AutomationError, type AutomationExecutor, type AutomationReadiness } from "./types.js";

const AUTOMATION_ACTIONS = new Set(["create_task", "supplement_evidence"]);

function recommendationAllowed(store: V2SqliteStore, evaluation: PolicyEvaluationView) {
  if (evaluation.candidateSource !== "ai_recommendation") return true;
  if (!evaluation.sourceRecommendationId || !evaluation.sourceOptionId) return false;
  const recommendation = store.getDecisionRecommendation(evaluation.tenantId, evaluation.sourceRecommendationId);
  if (!recommendation || recommendation.status !== "generated" || recommendation.contextId !== evaluation.contextId || recommendation.exceptionId !== evaluation.exceptionId) return false;
  const output = recommendation.output as { options?: Array<{ id: string; actionType: string }> } | undefined;
  const option = output?.options?.find((item) => item.id === evaluation.sourceOptionId);
  return Boolean(option && option.actionType === evaluation.candidateActionType);
}

export function buildAutomationReadiness(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  policyEvaluationId: string,
  options: { env?: Record<string, string | undefined>; executor?: AutomationExecutor } = {},
): AutomationReadiness {
  const evaluation = getPolicyEvaluation(store, tenantId, contextId, exceptionId, policyEvaluationId);
  if (!evaluation) throw new AutomationError("AUTOMATION_POLICY_EVALUATION_NOT_FOUND", 404);
  const env = options.env ?? process.env;
  const runtime = automationRuntimeConfig(env);
  const actionType = evaluation.candidateActionType;
  const metadata = getPolicyActionMetadata(actionType);
  const safetyBoundaryPassed = Boolean(
    AUTOMATION_ACTIONS.has(actionType)
    && metadata
    && metadata.customerFacing === false
    && metadata.financialMovement === false
    && metadata.legalEffect === false
    && metadata.reversible === true,
  );
  let executorSupportsAction = false;
  let executorConfigured = runtime.executorConfigured;
  if (runtime.enabled && runtime.executorConfigured) {
    try {
      const executor = resolveAutomationExecutor({ env, ...(options.executor ? { executor: options.executor } : {}) });
      executorSupportsAction = executor.supports(actionType);
    } catch {
      executorConfigured = false;
    }
  }
  const reasons: string[] = [];
  if (!runtime.enabled) reasons.push("AUTOMATION_DISABLED");
  if (!executorConfigured) reasons.push("AUTOMATION_EXECUTOR_NOT_CONFIGURED");
  if (evaluation.stale) reasons.push("AUTOMATION_POLICY_STALE");
  if (evaluation.decision.mode !== "auto_eligible") reasons.push("AUTOMATION_POLICY_NOT_ELIGIBLE");
  if (!safetyBoundaryPassed) reasons.push("AUTOMATION_EFFECT_NOT_ALLOWED");
  if (runtime.enabled && executorConfigured && !executorSupportsAction) reasons.push("AUTOMATION_ACTION_NOT_SUPPORTED");
  if (!recommendationAllowed(store, evaluation)) reasons.push("AUTOMATION_RECOMMENDATION_STALE");
  return {
    executable: reasons.length === 0,
    policyMode: evaluation.decision.mode,
    policyEvaluationStale: evaluation.stale,
    executorConfigured,
    executorSupportsAction,
    safetyBoundaryPassed,
    reasons,
  };
}
