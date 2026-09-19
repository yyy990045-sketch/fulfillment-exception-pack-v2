import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import { DefaultDecisionActionEligibilityResolver } from "./eligibility.js";
import { buildDecisionHistorySummary } from "./history-builder.js";
import { DecisionAiError, type DecisionRecommendationInput } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function decisionInputSnapshotHash(input: DecisionRecommendationInput) {
  return createHash("sha256").update(stableJson({ schemaVersion: "decision-recommendation/v1", ...input })).digest("hex");
}

export function buildDecisionRecommendationInput(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
): DecisionRecommendationInput {
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception) throw new DecisionAiError("DECISION_EXCEPTION_NOT_FOUND", 404);
  const evaluation = store.listRuleEvaluations(tenantId, contextId).find((item) => item.id === exception.latestRuleEvaluationId);
  if (!evaluation) throw new DecisionAiError("DECISION_RULE_EVALUATION_NOT_FOUND", 404);
  const definition = store.getRuleDefinition(tenantId, exception.ruleId);
  const version = store.getRuleVersionById(tenantId, exception.ruleVersionId);
  const bundle = store.getExceptionEvidenceBundle(tenantId, exception.id);
  if (!definition || !version || !bundle) throw new DecisionAiError("DECISION_CONTEXT_INCOMPLETE", 422);
  const history = buildDecisionHistorySummary(store, tenantId, exception.id, exception.code);
  const eligibleActions = new DefaultDecisionActionEligibilityResolver().resolve(exception);
  const entityIds = new Set(exception.entityIds);
  return {
    tenantId,
    contextId,
    exceptionId,
    exception: {
      id: exception.id,
      code: exception.code,
      severity: exception.severity,
      title: exception.title,
      summary: exception.summary,
      metrics: exception.metrics,
      matchKey: exception.matchKey,
      latestRuleEvaluationId: exception.latestRuleEvaluationId,
    },
    rule: { id: definition.id, code: definition.code, version: version.version },
    evaluation: {
      id: evaluation.id,
      status: evaluation.status,
      observations: evaluation.observations,
      metrics: evaluation.metrics,
    },
    evidence: bundle.evidence,
    sourceDocuments: bundle.sourceDocuments,
    sourceSystems: bundle.sourceSystems,
    contextFacts: store.listEntities(tenantId, contextId)
      .filter((entity) => entityIds.has(entity.id))
      .map((entity) => ({
        role: "context",
        entityId: entity.id,
        entityType: entity.entityType,
        businessKey: entity.businessKey,
        attributes: entity.attributes,
      })),
    history,
    eligibleActions,
  };
}
