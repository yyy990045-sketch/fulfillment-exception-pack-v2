import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import type { RootCauseAnalysisRecord, RootCauseHypothesisReview } from "../../domain/v2/root-cause-types.js";
import { buildRootCauseInput, rootCauseInputSnapshotHash } from "./context-builder.js";
import { buildRootCausePrompt } from "./prompt.js";
import {
  RootCauseAiError,
  type RootCauseAnalysisSummary,
  type RootCauseAnalysisView,
  type RootCauseProvider,
  type RootCauseValidation,
} from "./types.js";
import { parseRootCauseOutput, validateRootCauseOutput } from "./validator.js";

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

function analysisId(input: { tenantId: string; exceptionId: string; snapshotHash: string; provider: string; model: string }) {
  return `rca-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function parseValidation(value: unknown): RootCauseValidation {
  return value as RootCauseValidation;
}

function toView(store: V2SqliteStore, record: RootCauseAnalysisRecord): RootCauseAnalysisView {
  let stale = true;
  try {
    const current = buildRootCauseInput(store, record.tenantId, record.contextId, record.exceptionId);
    stale = record.ruleEvaluationId !== current.exception.latestRuleEvaluationId
      || record.inputSnapshotHash !== rootCauseInputSnapshotHash(current);
  } catch { /* keep stale when current context cannot be rebuilt */ }
  return {
    ...record,
    output: record.output as RootCauseAnalysisView["output"],
    validation: parseValidation(record.validation),
    stale,
  };
}

function toSummary(store: V2SqliteStore, record: RootCauseAnalysisRecord): RootCauseAnalysisSummary {
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
  if (error instanceof RootCauseAiError) return error;
  return new RootCauseAiError("ROOT_CAUSE_PROVIDER_FAILURE", 502);
}

export async function generateRootCauseAnalysis(
  store: V2SqliteStore,
  provider: RootCauseProvider,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  actor: string,
): Promise<RootCauseAnalysisView> {
  if (!actor.trim()) throw new RootCauseAiError("actor_required", 401);
  const input = buildRootCauseInput(store, tenantId, contextId, exceptionId);
  const snapshotHash = rootCauseInputSnapshotHash(input);
  return serialize([tenantId, exceptionId, snapshotHash, provider.name, provider.model].join(":"), async () => {
    const existing = store.getRootCauseAnalysisBySnapshot(tenantId, exceptionId, snapshotHash, provider.name, provider.model);
    if (existing) return toView(store, existing);
    let raw: unknown;
    try {
      raw = await provider.generate({ input, prompt: buildRootCausePrompt(input) });
    } catch (error) {
      throw providerError(error);
    }
    const output = parseRootCauseOutput(raw);
    const validation = validateRootCauseOutput(input, output);
    const record: RootCauseAnalysisRecord = {
      id: analysisId({ tenantId, exceptionId, snapshotHash, provider: provider.name, model: provider.model }),
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
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    return toView(store, store.saveRootCauseAnalysis(record));
  });
}

export function listRootCauseAnalyses(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
): RootCauseAnalysisSummary[] {
  return store.listRootCauseAnalyses(tenantId, contextId, exceptionId).map((record) => toSummary(store, record));
}

export function getRootCauseAnalysis(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  analysisIdValue: string,
): RootCauseAnalysisView | undefined {
  const record = store.getRootCauseAnalysis(tenantId, analysisIdValue);
  if (!record || record.contextId !== contextId || record.exceptionId !== exceptionId) return undefined;
  return toView(store, record);
}

export function rootCauseValidationErrorCode(validation: RootCauseValidation) {
  if (validation.citationErrors.length) return "ROOT_CAUSE_INVALID_CITATION";
  if (validation.numericErrors.length) return "ROOT_CAUSE_INVALID_NUMERIC";
  if (validation.unsupportedClaims.length) return "ROOT_CAUSE_UNSUPPORTED_CLAIM";
  if (validation.schemaErrors.length) return "ROOT_CAUSE_INVALID_SCHEMA";
  return "ROOT_CAUSE_VALIDATION_FAILED";
}

export function recordRootCauseHypothesisReview(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  analysisIdValue: string,
  hypothesisId: string,
  input: { decision: "investigate" | "needs_evidence" | "rejected"; rationale: string; actor: string },
): RootCauseHypothesisReview {
  const analysis = getRootCauseAnalysis(store, tenantId, contextId, exceptionId, analysisIdValue);
  if (!analysis) throw new RootCauseAiError("ROOT_CAUSE_ANALYSIS_NOT_FOUND", 404);
  if (analysis.status !== "generated") throw new RootCauseAiError("ROOT_CAUSE_ANALYSIS_NOT_REVIEWABLE", 422);
  if (!analysis.output.hypotheses.some((item) => item.id === hypothesisId)) {
    throw new RootCauseAiError("ROOT_CAUSE_HYPOTHESIS_NOT_FOUND", 404);
  }
  if (!input.rationale.trim()) throw new RootCauseAiError("ROOT_CAUSE_REVIEW_RATIONALE_REQUIRED", 422);
  const createdAt = new Date().toISOString();
  const review: RootCauseHypothesisReview = {
    id: `rcr-${createHash("sha256").update(JSON.stringify({
      tenantId,
      analysisIdValue,
      hypothesisId,
      decision: input.decision,
      rationale: input.rationale,
      actor: input.actor,
      createdAt,
    })).digest("hex").slice(0, 24)}`,
    tenantId,
    analysisId: analysisIdValue,
    hypothesisId,
    exceptionId,
    decision: input.decision,
    rationale: input.rationale.trim(),
    actor: input.actor,
    createdAt,
  };
  return store.saveRootCauseHypothesisReview(review);
}

export function listRootCauseHypothesisReviews(
  store: V2SqliteStore,
  tenantId: string,
  analysisId: string,
  hypothesisId?: string,
) {
  return store.listRootCauseHypothesisReviews(tenantId, analysisId, hypothesisId);
}
