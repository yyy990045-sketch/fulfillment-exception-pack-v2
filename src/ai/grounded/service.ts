import { createHash } from "node:crypto";
import type { GroundedExplanationRecord, V2SqliteStore } from "../../domain/v2/index.js";
import { buildGroundedExplanationInput, groundedInputSnapshotHash } from "./context-builder.js";
import { buildGroundedExplanationPrompt } from "./prompt.js";
import {
  GroundedAiError,
  type GroundedAiProvider,
  type GroundedExplanation,
  type GroundedExplanationSummary,
  type GroundedExplanationView,
  type GroundingValidation,
} from "./types.js";
import { parseGroundedExplanationOutput, validateGroundedExplanation } from "./validator.js";

const generationQueues = new Map<string, Promise<void>>();

async function serializeGeneration<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = generationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  generationQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (generationQueues.get(key) === queued) generationQueues.delete(key);
  }
}

function explanationId(input: {
  tenantId: string;
  exceptionId: string;
  inputSnapshotHash: string;
  provider: string;
  model: string;
}) {
  return `gexp-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function mapProviderError(error: unknown): GroundedAiError {
  if (error instanceof GroundedAiError) return error;
  if (error instanceof Error && error.name === "TimeoutError") return new GroundedAiError("AI_PROVIDER_TIMEOUT", 504);
  if (error instanceof Error && error.message === "AI_PROVIDER_TIMEOUT") return new GroundedAiError("AI_PROVIDER_TIMEOUT", 504);
  if (error instanceof Error && error.message === "AI_PROVIDER_INVALID_OUTPUT") return new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT", 502);
  return new GroundedAiError("AI_PROVIDER_FAILURE", 502);
}

function toExplanation(record: GroundedExplanationRecord): GroundedExplanation {
  const output = parseGroundedExplanationOutput(record.output);
  const validation = record.validation as GroundingValidation;
  if (
    !validation ||
    typeof validation !== "object" ||
    typeof validation.valid !== "boolean" ||
    !Array.isArray(validation.citationErrors) ||
    !Array.isArray(validation.numericErrors) ||
    !Array.isArray(validation.unsupportedClaims) ||
    typeof validation.validatedAt !== "string"
  ) {
    throw new GroundedAiError("GROUNDED_EXPLANATION_RECORD_CORRUPT", 500);
  }
  return { ...record, output, validation };
}

function isStale(store: V2SqliteStore, record: GroundedExplanationRecord) {
  try {
    const current = buildGroundedExplanationInput(store, record.tenantId, record.contextId, record.exceptionId);
    return record.ruleEvaluationId !== current.exception.latestRuleEvaluationId ||
      record.inputSnapshotHash !== groundedInputSnapshotHash(current);
  } catch {
    return true;
  }
}

export function groundingValidationErrorCode(validation: GroundingValidation) {
  if (validation.citationErrors.length) return "AI_GROUNDING_INVALID_CITATION";
  if (validation.numericErrors.length) return "AI_GROUNDING_NUMERIC_MISMATCH";
  if (validation.unsupportedClaims.length) return "AI_GROUNDING_UNSUPPORTED_CLAIM";
  return undefined;
}

export async function generateGroundedExplanation(
  store: V2SqliteStore,
  provider: GroundedAiProvider,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  actor: string,
): Promise<GroundedExplanationView> {
  if (!actor.trim()) throw new GroundedAiError("actor_required", 401);
  const input = buildGroundedExplanationInput(store, tenantId, contextId, exceptionId);
  const inputSnapshotHash = groundedInputSnapshotHash(input);
  const queueKey = [tenantId, exceptionId, inputSnapshotHash, provider.name, provider.model].join(":");
  return serializeGeneration(queueKey, async () => {
    const existing = store.getGroundedExplanationBySnapshot(tenantId, exceptionId, inputSnapshotHash, provider.name, provider.model);
    if (existing) return { ...toExplanation(existing), stale: false };

    const prompt = buildGroundedExplanationPrompt(input);
    let rawOutput: unknown;
    try {
      rawOutput = await provider.generate({ input, prompt });
    } catch (error) {
      throw mapProviderError(error);
    }
    const output = parseGroundedExplanationOutput(rawOutput);
    const validation = validateGroundedExplanation(input, output);
    const record: GroundedExplanationRecord = {
      id: explanationId({
        tenantId,
        exceptionId,
        inputSnapshotHash,
        provider: provider.name,
        model: provider.model,
      }),
      tenantId,
      contextId,
      exceptionId,
      ruleEvaluationId: input.exception.latestRuleEvaluationId,
      inputSnapshotHash,
      provider: provider.name,
      model: provider.model,
      status: validation.valid ? "generated" : "rejected",
      output,
      validation,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    return { ...toExplanation(store.saveGroundedExplanation(record)), stale: false };
  });
}

export function listGroundedExplanations(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
): GroundedExplanationSummary[] {
  return store.listGroundedExplanations(tenantId, contextId, exceptionId).map((record) => {
    const explanation = toExplanation(record);
    return {
      id: explanation.id,
      tenantId: explanation.tenantId,
      contextId: explanation.contextId,
      exceptionId: explanation.exceptionId,
      ruleEvaluationId: explanation.ruleEvaluationId,
      inputSnapshotHash: explanation.inputSnapshotHash,
      provider: explanation.provider,
      model: explanation.model,
      status: explanation.status,
      createdBy: explanation.createdBy,
      createdAt: explanation.createdAt,
      stale: isStale(store, record),
    };
  });
}

export function getGroundedExplanation(
  store: V2SqliteStore,
  tenantId: string,
  contextId: string,
  exceptionId: string,
  explanationIdValue: string,
): GroundedExplanationView | undefined {
  const record = store.getGroundedExplanation(tenantId, explanationIdValue);
  if (!record || record.contextId !== contextId || record.exceptionId !== exceptionId) return undefined;
  return { ...toExplanation(record), stale: isStale(store, record) };
}
