import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import { DecisionRuntime } from "./runtime.js";
import { DecisionRuntimeError, type DecisionBatchResult, type DecisionRequest, type DecisionRuntimeAuditContext } from "./types.js";

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function evaluateWithAudit(
  store: V2SqliteStore,
  provider: { name: string; model: string; evaluateBatch(request: DecisionRequest): Promise<DecisionBatchResult> },
  request: DecisionRequest,
  audit: DecisionRuntimeAuditContext | undefined,
) {
  const startedAt = performance.now();
  const createdAt = new Date().toISOString();
  try {
    const result = await new DecisionRuntime().evaluateBatch(provider, request);
    if (audit) store.saveDecisionRuntimeCall({
      tenantId: audit.tenantId,
      id: `drcall-${hash({ taskId: request.taskId, provider: provider.name, model: provider.model, at: createdAt }).slice(0, 24)}`,
      taskId: request.taskId,
      provider: provider.name,
      model: provider.model,
      stateHash: hash(request.state),
      questionHash: hash(request.questions),
      answer: result.answers,
      latencyMs: Math.round(performance.now() - startedAt),
      ...(result.usage ? { usage: result.usage } : {}),
      status: "succeeded",
      createdBy: audit.actor,
      createdAt,
    });
    return result;
  } catch (error) {
    if (audit) store.saveDecisionRuntimeCall({
      tenantId: audit.tenantId,
      id: `drcall-${hash({ taskId: request.taskId, provider: provider.name, model: provider.model, at: createdAt }).slice(0, 24)}`,
      taskId: request.taskId,
      provider: provider.name,
      model: provider.model,
      stateHash: hash(request.state),
      questionHash: hash(request.questions),
      answer: null,
      latencyMs: Math.round(performance.now() - startedAt),
      status: "failed",
      errorCode: error instanceof DecisionRuntimeError ? error.code : "DECISION_PROVIDER_FAILURE",
      createdBy: audit.actor,
      createdAt,
    });
    throw error;
  }
}
