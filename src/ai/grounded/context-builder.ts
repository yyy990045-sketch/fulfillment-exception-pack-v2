import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import { GroundedAiError, type GroundedExplanationInput } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function groundedInputSnapshotHash(input: GroundedExplanationInput) {
  return createHash("sha256").update(stableJson({
    ...input,
    evidence: [...input.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
  })).digest("hex");
}

export function buildGroundedExplanationInput(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
): GroundedExplanationInput {
  const context = store.getContext(tenantId, contextId);
  if (!context) throw new GroundedAiError("GROUNDED_CONTEXT_NOT_FOUND", 404);
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception) throw new GroundedAiError("GROUNDED_EXCEPTION_NOT_FOUND", 404);
  const evaluation = store.listRuleEvaluations(tenantId, contextId)
    .find((item) => item.id === exception.latestRuleEvaluationId);
  if (!evaluation) throw new GroundedAiError("GROUNDED_RULE_EVALUATION_NOT_FOUND", 404);
  const definition = store.getRuleDefinition(tenantId, exception.ruleId);
  const version = store.getRuleVersionById(tenantId, exception.ruleVersionId);
  const bundle = store.getExceptionEvidenceBundle(tenantId, exceptionId);
  if (!definition || !version || !bundle || bundle.contextId !== contextId) {
    throw new GroundedAiError("GROUNDED_EXCEPTION_CONTEXT_INCOMPLETE", 422);
  }
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
      latestRuleEvaluationId: exception.latestRuleEvaluationId,
      matchKey: exception.matchKey,
    },
    rule: {
      id: definition.id,
      code: definition.code,
      version: version.version,
    },
    evaluation: {
      id: evaluation.id,
      status: evaluation.status,
      observations: evaluation.observations,
      metrics: evaluation.metrics,
    },
    evidence: bundle.evidence,
    sourceDocuments: bundle.sourceDocuments,
    sourceSystems: bundle.sourceSystems,
    contextFacts: store.listEntities(tenantId, contextId).filter((entity) => entityIds.has(entity.id)),
    sourceChanged: false,
  };
}
