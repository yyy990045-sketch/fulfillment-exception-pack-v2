import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import type {
  DecisionRecommendationDisposition,
  DecisionRecommendationRecord,
} from "../../domain/v2/decision-types.js";
import { buildDecisionRecommendationInput, decisionInputSnapshotHash } from "./context-builder.js";
import { buildDecisionRecommendationPrompt } from "./prompt.js";
import { parseDecisionRecommendationOutput, validateDecisionRecommendation } from "./validator.js";
import {
  DecisionAiError,
  type DecisionRecommendationOutput,
  type DecisionRecommendationProvider,
  type DecisionRecommendationSummary,
  type DecisionRecommendationValidation,
  type DecisionRecommendationView,
} from "./types.js";

const queues = new Map<string, Promise<void>>();

async function serialize<T>(key: string, operation: () => Promise<T>) {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  queues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(key) === queued) queues.delete(key);
  }
}

function recommendationId(input: { tenantId: string; exceptionId: string; snapshotHash: string; provider: string; model: string }) {
  return `drec-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function parseValidation(value: unknown): DecisionRecommendationValidation {
  return value as DecisionRecommendationValidation;
}

function toView(store: V2SqliteStore, record: DecisionRecommendationRecord): DecisionRecommendationView {
  let stale = true;
  try {
    const current = buildDecisionRecommendationInput(store, record.tenantId, record.contextId, record.exceptionId);
    stale = record.ruleEvaluationId !== current.exception.latestRuleEvaluationId || record.inputSnapshotHash !== decisionInputSnapshotHash(current);
  } catch { /* keep stale when current context cannot be rebuilt */ }
  return {
    ...record,
    output: record.output as DecisionRecommendationOutput,
    validation: parseValidation(record.validation),
    historySnapshot: record.historySnapshot as DecisionRecommendationView["historySnapshot"],
    eligibility: record.eligibility as DecisionRecommendationView["eligibility"],
    stale,
  };
}

function toSummary(store: V2SqliteStore, record: DecisionRecommendationRecord): DecisionRecommendationSummary {
  const view = toView(store, record);
  return {
    id: view.id,
    tenantId: view.tenantId,
    contextId: view.contextId,
    exceptionId: view.exceptionId,
    ruleEvaluationId: view.ruleEvaluationId,
    inputSnapshotHash: view.inputSnapshotHash,
    provider: view.provider,
    model: view.model,
    status: view.status,
    createdBy: view.createdBy,
    createdAt: view.createdAt,
    stale: view.stale,
  };
}

function providerError(error: unknown) {
  if (error instanceof DecisionAiError) return error;
  return new DecisionAiError("DECISION_PROVIDER_FAILURE", 502);
}

export async function generateDecisionRecommendation(
  store: V2SqliteStore,
  provider: DecisionRecommendationProvider,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  actor: string,
) {
  if (!actor.trim()) throw new DecisionAiError("actor_required", 401);
  const input = buildDecisionRecommendationInput(store, tenantId, contextId, exceptionId);
  const snapshotHash = decisionInputSnapshotHash(input);
  return serialize([tenantId, exceptionId, snapshotHash, provider.name, provider.model].join(":"), async () => {
    const existing = store.getDecisionRecommendationBySnapshot(tenantId, exceptionId, snapshotHash, provider.name, provider.model);
    if (existing) return toView(store, existing);
    let raw: unknown;
    try {
      raw = await provider.generate({ input, prompt: buildDecisionRecommendationPrompt(input) });
    } catch (error) {
      throw providerError(error);
    }
    const output = parseDecisionRecommendationOutput(raw);
    const validation = validateDecisionRecommendation(input, output);
    const record: DecisionRecommendationRecord = {
      id: recommendationId({ tenantId, exceptionId, snapshotHash, provider: provider.name, model: provider.model }),
      tenantId,
      contextId,
      exceptionId,
      ruleEvaluationId: input.exception.latestRuleEvaluationId,
      inputSnapshotHash: snapshotHash,
      provider: provider.name,
      model: provider.model,
      status: validation.valid ? "generated" : "rejected",
      output,
      validation,
      historySnapshot: input.history,
      eligibility: input.eligibleActions,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    return toView(store, store.saveDecisionRecommendation(record));
  });
}

export function listDecisionRecommendations(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
): DecisionRecommendationSummary[] {
  return store.listDecisionRecommendations(tenantId, contextId, exceptionId).map((record) => toSummary(store, record));
}

export function getDecisionRecommendation(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  recommendationIdValue: string,
) {
  const record = store.getDecisionRecommendation(tenantId, recommendationIdValue);
  if (!record || record.contextId !== contextId || record.exceptionId !== exceptionId) return undefined;
  return toView(store, record);
}

export function decisionValidationErrorCode(validation: DecisionRecommendationValidation) {
  if (validation.citationErrors.length) return "DECISION_GROUNDING_INVALID_CITATION";
  if (validation.numericErrors.length) return "DECISION_GROUNDING_NUMERIC_MISMATCH";
  if (validation.historyErrors.length) return "DECISION_GROUNDING_HISTORY_MISMATCH";
  if (validation.eligibilityErrors.length) return "DECISION_ACTION_NOT_ELIGIBLE";
  if (validation.unsupportedClaims.length) return "DECISION_GROUNDING_UNSUPPORTED_CLAIM";
  if (validation.schemaErrors.length) return "DECISION_GROUNDING_SCHEMA_ERROR";
  return "DECISION_GROUNDING_VALIDATION_FAILED";
}

export function recordDecisionRecommendationDisposition(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  recommendationIdValue: string,
  input: { decision: "accepted" | "modified" | "rejected"; selectedOptionId?: string; rationale: string; actor: string },
) {
  const recommendation = getDecisionRecommendation(store, tenantId, contextId, exceptionId, recommendationIdValue);
  if (!recommendation) throw new DecisionAiError("DECISION_RECOMMENDATION_NOT_FOUND", 404);
  if (!input.rationale.trim()) throw new DecisionAiError("DECISION_DISPOSITION_RATIONALE_REQUIRED", 422);
  if (
    (input.decision !== "rejected" && !input.selectedOptionId)
    || (input.selectedOptionId && !recommendation.output.options.some((option) => option.id === input.selectedOptionId))
  ) {
    throw new DecisionAiError("DECISION_SELECTED_OPTION_INVALID", 422);
  }
  const disposition: DecisionRecommendationDisposition = {
    id: `ddisp-${createHash("sha256").update(JSON.stringify({ tenantId, recommendationIdValue, ...input, createdAt: new Date().toISOString() })).digest("hex").slice(0, 24)}`,
    tenantId,
    recommendationId: recommendationIdValue,
    exceptionId,
    decision: input.decision,
    ...(input.selectedOptionId ? { selectedOptionId: input.selectedOptionId } : {}),
    rationale: input.rationale.trim(),
    actor: input.actor,
    createdAt: new Date().toISOString(),
  };
  return store.saveDecisionRecommendationDisposition(disposition);
}

export function listDecisionRecommendationDispositions(store: V2SqliteStore, tenantId: string, recommendationId: string) {
  return store.listDecisionRecommendationDispositions(tenantId, recommendationId);
}
