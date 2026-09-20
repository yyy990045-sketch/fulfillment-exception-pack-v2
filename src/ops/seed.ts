/**
 * 用于备份/恢复验证的最小真实业务数据种子（不是 mock，走真实领域 API）。
 *
 * 覆盖：Context / Exception / Evidence / Resolution / Audit Event —— 正好是恢复演练要读回的五类记录。
 */
import { openSqlite } from "./sqlite-runtime.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  V2SqliteStore,
  acceptExceptionForResolution,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
} from "../domain/v2/index.js";
import { recordSecurityAudit } from "../security/audit.js";

export const OPS_SEED_TENANT = "demo-manufacturing";
export const OPS_SEED_CONTEXT = "ctx-so-mfg-001";

export function seedOperationalDatabase(databasePath: string) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = openSqlite(databasePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  const evaluated = evaluateContextRules(store, OPS_SEED_TENANT, OPS_SEED_CONTEXT);
  if (!evaluated?.exceptions.length) throw new Error("OPS_SEED_EXCEPTION_MISSING");
  const exception = evaluated.exceptions[0]!;
  const resolution = acceptExceptionForResolution(store, OPS_SEED_TENANT, OPS_SEED_CONTEXT, exception.id, {
    ownerRole: "品质负责人",
    rationale: "运维恢复演练用：确认异常进入治理流程。",
    actor: { subjectId: "ops-seed", displayName: "运维种子", roles: ["品质负责人"] },
  });
  recordSecurityAudit(store, {
    auth: { tenantId: OPS_SEED_TENANT, subjectId: "ops-seed", roles: ["品质负责人"] },
    action: "resolution.accept",
    resourceType: "resolution_case",
    resourceId: resolution?.id ?? exception.id,
    result: "success",
    metadata: { contextId: OPS_SEED_CONTEXT, exceptionId: exception.id },
  });
  const snapshot = {
    tenantId: OPS_SEED_TENANT,
    contextId: OPS_SEED_CONTEXT,
    exceptionId: exception.id,
    resolutionId: resolution?.id ?? "",
  };
  db.close();
  return snapshot;
}

export function readOperationalCounts(databasePath: string, tenantId = OPS_SEED_TENANT, contextId = OPS_SEED_CONTEXT) {
  const db = openSqlite(databasePath, { readOnly: true });
  try {
    const count = (sql: string, ...params: string[]) =>
      Number((db.prepare(sql).get(...params) as { c: number } | undefined)?.c ?? 0);
    return {
      contexts: count("SELECT COUNT(*) c FROM fulfillment_contexts WHERE tenant_id = ?", tenantId),
      exceptions: count("SELECT COUNT(*) c FROM exceptions WHERE tenant_id = ? AND context_id = ?", tenantId, contextId),
      evidence: count("SELECT COUNT(*) c FROM v2_evidence WHERE tenant_id = ? AND context_id = ?", tenantId, contextId),
      resolutionCases: count("SELECT COUNT(*) c FROM resolution_cases WHERE tenant_id = ? AND context_id = ?", tenantId, contextId),
      auditEvents: count("SELECT COUNT(*) c FROM security_audit_events WHERE tenant_id = ?", tenantId),
      migrationVersion: (db.prepare("SELECT MAX(version) v FROM v2_schema_migrations").get() as { v: string } | undefined)?.v ?? null,
    };
  } finally {
    db.close();
  }
}
