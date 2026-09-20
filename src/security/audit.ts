/**
 * 安全审计写入（敏感 mutation 留痕）。
 *
 * 记录：tenantId / subjectId / roles / actorType / action / resourceType / resourceId /
 * result / timestamp。
 * 明确**不**记录：JWT、password、secret、authorization header、请求原文。
 */
import { randomUUID } from "node:crypto";
import type { V2SqliteStore } from "../domain/v2/index.js";
import type { SecurityAuditActorType } from "../domain/v2/security-audit-types.js";
import type { AuthContext } from "../auth.js";
import { currentRequestContext } from "../ops/request-context.js";

/** 落入审计的 metadata 只允许这些键，其余一律丢弃（防止误写密钥/头部） */
const ALLOWED_METADATA_KEYS = new Set([
  "exceptionId",
  "contextId",
  "resolutionCaseId",
  "connectorId",
  "installationId",
  "packId",
  "workItemId",
  "outboxId",
  "decision",
  "status",
  "reasonCode",
  "actionCount",
  "requestId",
]);

export const SENSITIVE_AUDIT_ACTIONS = [
  "decision.recommend",
  "decision.disposition",
  "resolution.accept",
  "resolution.review",
  "resolution.propose",
  "resolution.submit",
  "resolution.approve",
  "resolution.reject",
  "resolution.execute",
  "resolution.close",
  "connector.install",
  "solution_pack.install",
  "internal_work_item.deliver",
] as const;

export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (value === undefined) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

export function recordSecurityAudit(
  store: V2SqliteStore,
  input: {
    auth: Pick<AuthContext, "tenantId" | "subjectId" | "roles">;
    action: string;
    resourceType: string;
    resourceId: string;
    result: string;
    actorType?: SecurityAuditActorType;
    metadata?: Record<string, unknown>;
    now?: () => Date;
  },
) {
  const requestId = currentRequestContext()?.requestId;
  return store.saveSecurityAuditEvent({
    tenantId: input.auth.tenantId,
    id: `audit-${randomUUID()}`,
    actorType: input.actorType ?? "user",
    subjectId: input.auth.subjectId,
    roles: [...input.auth.roles],
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    result: input.result,
    occurredAt: (input.now ?? (() => new Date()))().toISOString(),
    metadata: sanitizeAuditMetadata({ ...input.metadata, ...(requestId ? { requestId } : {}) }),
  });
}
