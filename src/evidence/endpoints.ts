import { createHash } from "node:crypto";
import type { EvidenceSourceAttempt } from "../types.js";

export type EvidenceEndpoint = { id: string; url: string };
export type EvidenceSourceResult = { body: string; selectedEndpointId: string; attempts: EvidenceSourceAttempt[] };

export class EvidenceSourceError extends Error {
  constructor(public readonly code: "evidence_source_unavailable" | "evidence_source_rejected", public readonly attempts: EvidenceSourceAttempt[]) {
    super(code);
    this.name = "EvidenceSourceError";
  }
}

function hash(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

function errorCode(error: unknown): "timeout" | "network" {
  return error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network";
}

export async function resolveEvidenceSource(
  endpoints: EvidenceEndpoint[],
  options: { timeoutMs?: number; fetchImpl?: typeof fetch; validate?: (body: string) => void; validationErrorCode?: EvidenceSourceAttempt["errorCode"] } = {},
): Promise<EvidenceSourceResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts: EvidenceSourceAttempt[] = [];
  for (const endpoint of endpoints) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
    try {
      const response = await fetchImpl(endpoint.url, { signal: controller.signal });
      const body = await response.text();
      const durationMs = Date.now() - started;
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        attempts.push({ endpointId: endpoint.id, status: response.status, outcome: retryable ? "fallback" : "failed", errorCode: "http", durationMs });
        if (!retryable) throw new EvidenceSourceError("evidence_source_rejected", attempts);
        continue;
      }
      if (!body.trim()) {
        attempts.push({ endpointId: endpoint.id, status: response.status, outcome: "fallback", errorCode: "empty", durationMs });
        continue;
      }
      try { options.validate?.(body); }
      catch {
        attempts.push({ endpointId: endpoint.id, status: response.status, outcome: "fallback", errorCode: options.validationErrorCode ?? "invalid_csv", durationMs, contentHash: hash(body) });
        continue;
      }
      attempts.push({ endpointId: endpoint.id, status: response.status, outcome: "selected", durationMs, contentHash: hash(body) });
      return { body, selectedEndpointId: endpoint.id, attempts };
    } catch (error) {
      if (error instanceof EvidenceSourceError) throw error;
      attempts.push({ endpointId: endpoint.id, outcome: "fallback", errorCode: errorCode(error), durationMs: Date.now() - started });
    } finally { clearTimeout(timer); }
  }
  throw new EvidenceSourceError("evidence_source_unavailable", attempts.map((attempt, index, all) => index === all.length - 1 ? { ...attempt, outcome: "failed" } : attempt));
}
