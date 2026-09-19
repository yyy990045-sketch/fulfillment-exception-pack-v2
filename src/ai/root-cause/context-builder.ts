import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import { RootCauseAiError, type RootCauseInput } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function rootCauseInputSnapshotHash(input: RootCauseInput) {
  return createHash("sha256").update(stableJson({
    schemaVersion: "root-cause-hypothesis/v1",
    exception: input.exception,
    rule: input.rule,
    evaluation: input.evaluation,
    evidence: [...input.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    sourceDocuments: [...input.sourceDocuments].sort((left, right) => left.id.localeCompare(right.id)),
    sourceSystems: [...input.sourceSystems].sort((left, right) => left.id.localeCompare(right.id)),
    contextFacts: [...input.contextFacts].sort((left, right) => left.id.localeCompare(right.id)),
  })).digest("hex");
}

export function buildRootCauseInput(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
): RootCauseInput {
  const context = store.getContext(tenantId, contextId);
  if (!context) throw new RootCauseAiError("ROOT_CAUSE_CONTEXT_NOT_FOUND", 404);
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception) throw new RootCauseAiError("ROOT_CAUSE_EXCEPTION_NOT_FOUND", 404);
  const evaluation = store.listRuleEvaluations(tenantId, contextId)
    .find((item) => item.id === exception.latestRuleEvaluationId);
  if (!evaluation) throw new RootCauseAiError("ROOT_CAUSE_RULE_EVALUATION_NOT_FOUND", 404);
  const definition = store.getRuleDefinition(tenantId, exception.ruleId);
  const version = store.getRuleVersionById(tenantId, exception.ruleVersionId);
  const bundle = store.getExceptionEvidenceBundle(tenantId, exceptionId);
  if (!definition || !version || !bundle || bundle.contextId !== contextId) {
    throw new RootCauseAiError("ROOT_CAUSE_CONTEXT_INCOMPLETE", 422);
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
    contextFacts: store.listEntities(tenantId, contextId).filter((entity) => entityIds.has(entity.id)),
  };
}
