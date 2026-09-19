import { createHash } from "node:crypto";
import type { V2Evidence, V2SqliteStore } from "../domain/v2/index.js";
import type { OutcomeDefinitionRecord, OutcomeEvaluationRecord } from "../domain/v2/outcome-types.js";
import { latestMatchingEvidence, evaluateOutcomeStatus } from "./evaluator.js";
import { baselineFromMetrics, emptyCurrent } from "./measurement.js";
import { outcomeSnapshotHash } from "./snapshot.js";
import { OutcomeError, type OutcomeEvaluationInput, type OutcomeEvaluationView } from "./types.js";

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

function evaluationId(input: { tenantId: string; exceptionId: string; definitionId: string; snapshotHash: string }) {
  return `outcome-${hash(input).slice(0, 24)}`;
}

function evidenceForValidation(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  evidenceIds: string[],
) {
  const all = store.listEvidence(tenantId, contextId);
  const byId = new Map(all.map((item) => [item.id, item]));
  for (const id of evidenceIds) {
    const item = byId.get(id);
    if (!item || item.tenantId !== tenantId || item.contextId !== contextId) throw new OutcomeError("OUTCOME_EVIDENCE_NOT_FOUND", 422);
  }
  return evidenceIds.flatMap((id) => byId.get(id) ?? []);
}

function validateIntervention(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  input: OutcomeEvaluationInput,
) {
  if (input.resolutionCaseId && input.automationRunId) throw new OutcomeError("OUTCOME_INTERVENTION_AMBIGUOUS", 422);
  if (input.resolutionCaseId) {
    const resolution = store.getResolutionCase(tenantId, input.resolutionCaseId);
    if (!resolution || resolution.contextId !== contextId || resolution.exceptionId !== exceptionId) {
      throw new OutcomeError("OUTCOME_INTERVENTION_MISMATCH", 422);
    }
  }
  if (input.automationRunId) {
    const run = store.getAutomationRun(tenantId, input.automationRunId);
    if (!run || run.contextId !== contextId || run.exceptionId !== exceptionId) {
      throw new OutcomeError("OUTCOME_INTERVENTION_MISMATCH", 422);
    }
  }
}

function newestDefinition(store: V2SqliteStore, tenantId: string, exceptionCode: string, definitionId: string) {
  return store
    .listOutcomeDefinitions(tenantId, exceptionCode, true)
    .filter((item) => item.id === definitionId)
    .sort((left, right) => right.version.localeCompare(left.version))[0];
}

function isStale(
  store: V2SqliteStore,
  record: OutcomeEvaluationRecord,
) {
  try {
    const exception = store.listExceptions(record.tenantId, record.contextId).find((item) => item.id === record.exceptionId);
    if (!exception || exception.latestRuleEvaluationId !== record.ruleEvaluationId) return true;
    const newerDefinition = newestDefinition(store, record.tenantId, exception.code, record.definitionId);
    if (!newerDefinition || newerDefinition.version !== record.definitionVersion) return true;
    const allEvidence = store.listEvidence(record.tenantId, record.contextId);
    const byId = new Map(allEvidence.map((item) => [item.id, item]));
    for (const evidenceId of record.evidenceIds) {
      const current = byId.get(evidenceId);
      if (!current) return true;
      const superseding = allEvidence.some((item) =>
        item.sourceDocumentId === current.sourceDocumentId
        && item.id !== current.id
        && item.sourceVersion !== current.sourceVersion
        && item.createdAt > current.createdAt);
      if (superseding) return true;
    }
    if (record.resolutionCaseId && !store.getResolutionCase(record.tenantId, record.resolutionCaseId)) return true;
    if (record.automationRunId && !store.getAutomationRun(record.tenantId, record.automationRunId)) return true;
    return false;
  } catch {
    return true;
  }
}

function toView(store: V2SqliteStore, record: OutcomeEvaluationRecord): OutcomeEvaluationView {
  const definition = store.getOutcomeDefinition(record.tenantId, record.definitionId, record.definitionVersion);
  const evidence = store.listEvidence(record.tenantId, record.contextId).filter((item) => record.evidenceIds.includes(item.id));
  const latestEvidence = evidence.sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
  return {
    ...record,
    baseline: record.baseline as OutcomeEvaluationView["baseline"],
    current: record.current as OutcomeEvaluationView["current"],
    targetValue: definition?.targetValue ?? 0,
    comparison: definition?.comparison ?? "eq",
    betterDirection: definition?.betterDirection ?? "toward_target",
    measuredAt: latestEvidence?.observedAt ?? record.evaluatedAt,
    truthfulness: {
      evidenceBacked: evidence.length > 0,
      causalAttribution: false,
    },
    syntheticEvidence: evidence.some((item) => item.metadata.synthetic === true),
    stale: isStale(store, record),
  };
}

export function evaluateOutcome(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  input: OutcomeEvaluationInput,
  actor: string,
): OutcomeEvaluationView {
  if (!actor.trim()) throw new OutcomeError("actor_required", 401);
  const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
  if (!exception) throw new OutcomeError("OUTCOME_EXCEPTION_NOT_FOUND", 404);
  const definition = newestDefinition(store, tenantId, exception.code, input.definitionId);
  if (!definition) throw new OutcomeError("OUTCOME_DEFINITION_NOT_FOUND", 404);
  const evaluation = store.listRuleEvaluations(tenantId, contextId).find((item) => item.id === exception.latestRuleEvaluationId);
  if (!evaluation) throw new OutcomeError("OUTCOME_RULE_EVALUATION_NOT_FOUND", 404);
  validateIntervention(store, tenantId, contextId, exceptionId, input);
  const requestedEvidence = evidenceForValidation(store, tenantId, contextId, input.evidenceIds);
  const measurementEvidence = latestMatchingEvidence(requestedEvidence, definition.currentEvidenceField, input.evidenceIds);
  if (input.evidenceIds.length && !measurementEvidence) throw new OutcomeError("OUTCOME_EVIDENCE_FIELD_MISMATCH", 422);
  if (measurementEvidence && typeof measurementEvidence.value !== "string" && typeof measurementEvidence.value !== "number") {
    throw new OutcomeError("OUTCOME_EVIDENCE_VALUE_INVALID", 422);
  }
  const baseline = baselineFromMetrics(definition.baselineMetricKey, exception.metrics, evaluation.metrics);
  if (!baseline) throw new OutcomeError("OUTCOME_BASELINE_INSUFFICIENT", 422);
  const current = measurementEvidence
    ? {
        field: definition.currentEvidenceField,
        value: measurementEvidence.value as string | number,
        evidenceIds: [measurementEvidence.id],
      }
    : emptyCurrent(definition.currentEvidenceField, input.evidenceIds);
  const snapshotHash = outcomeSnapshotHash({
    definitionContentHash: definition.contentHash,
    ruleEvaluationId: exception.latestRuleEvaluationId,
    evidence: requestedEvidence.map((item) => ({ id: item.id, sourceVersion: item.sourceVersion, value: item.value })),
    ...(input.resolutionCaseId ? { resolutionCaseId: input.resolutionCaseId } : {}),
    ...(input.automationRunId ? { automationRunId: input.automationRunId } : {}),
  });
  const existing = store.getOutcomeEvaluationBySnapshot(tenantId, exceptionId, definition.id, definition.version, snapshotHash);
  if (existing) return toView(store, existing);
  const status = evaluateOutcomeStatus({
    baseline,
    current,
    comparison: definition.comparison,
    targetValue: definition.targetValue,
    betterDirection: definition.betterDirection,
  });
  const record: OutcomeEvaluationRecord = {
    tenantId,
    id: evaluationId({ tenantId, exceptionId, definitionId: definition.id, snapshotHash }),
    contextId,
    exceptionId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    ruleEvaluationId: exception.latestRuleEvaluationId,
    ...(input.resolutionCaseId ? { resolutionCaseId: input.resolutionCaseId } : {}),
    ...(input.automationRunId ? { automationRunId: input.automationRunId } : {}),
    evidenceIds: input.evidenceIds,
    baseline,
    current,
    status,
    definitionSnapshotHash: snapshotHash,
    evaluatedBy: actor,
    evaluatedAt: new Date().toISOString(),
  };
  return toView(store, store.saveOutcomeEvaluation(record));
}

export function listOutcomeEvaluations(store: V2SqliteStore, tenantId: string, contextId: string, exceptionId: string) {
  return store.listOutcomeEvaluations(tenantId, contextId, exceptionId).map((record) => toView(store, record));
}

export function getOutcomeEvaluation(store: V2SqliteStore, tenantId: string, contextId: string, exceptionId: string, evaluationId: string) {
  const record = store.getOutcomeEvaluation(tenantId, evaluationId);
  if (!record || record.contextId !== contextId || record.exceptionId !== exceptionId) return undefined;
  return toView(store, record);
}
