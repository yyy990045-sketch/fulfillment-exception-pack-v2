/**
 * /api/ready（readiness）与 /api/v2/ops/status（运维状态）的共享计算。
 *
 * 原则：
 *   - readiness 只关心核心自身（DB 可打开、migration 完成、store 可写、运行配置有效）
 *   - 外部集成（Superset / Power BI / open supOS / Jev）未配置**不影响** readiness
 *   - 只有显式标记为 required 的集成缺失，才让 readiness 失败
 *   - 磁盘只产生 warning/critical 提示，不无依据地破坏服务
 */
import { statfsSync, statSync } from "node:fs";
import type { SqliteHandle } from "./sqlite-runtime.js";
import { isDemoMode, validateAuthEnv } from "../auth.js";
import { isPowerBiConfigured } from "../integrations/powerbi/config.js";
import { isSupersetConfigured } from "../integrations/superset/config.js";
import { resolveDatabasePaths } from "./db-path.js";
import { applicationVersion, readSchemaState } from "./sqlite-backup.js";

export type OpsCheckStatus = "pass" | "warn" | "fail";

export type OpsCheck = {
  id: string;
  status: OpsCheckStatus;
  detail: string;
};

export type IntegrationRequirement = "superset" | "powerbi" | "openSupos" | "jev";

export function requiredIntegrations(env: Record<string, string | undefined> = process.env): IntegrationRequirement[] {
  const required: IntegrationRequirement[] = [];
  if (env.SUPERSET_REQUIRED === "true") required.push("superset");
  if (env.POWERBI_REQUIRED === "true") required.push("powerbi");
  if (env.OPEN_SUPOS_REQUIRED === "true") required.push("openSupos");
  if (env.JEV_REQUIRED === "true") required.push("jev");
  return required;
}

export function integrationConfiguration(env: Record<string, string | undefined> = process.env) {
  return {
    superset: isSupersetConfigured(env as NodeJS.ProcessEnv) ? "configured" : "unconfigured",
    powerbi: isPowerBiConfigured(env as NodeJS.ProcessEnv) ? "configured" : "unconfigured",
    openSupos: env.OPEN_SUPOS_ENABLED === "true" && Boolean(env.OPEN_SUPOS_MQTT_URL || env.OPEN_SUPOS_BASE_URL)
      ? "configured"
      : "unconfigured",
    jev: env.JEV_ENABLED === "true" && Boolean(env.JEV_BASE_URL) ? "configured" : "unconfigured",
  } as const;
}

export function diskUsage(path: string) {
  const stats = statfsSync(path);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : 0;
  return { path, totalBytes, freeBytes, usedPercent };
}

export function diskThresholds(env: Record<string, string | undefined> = process.env) {
  const warn = Number(env.OPS_DISK_WARN_PERCENT ?? "90");
  const critical = Number(env.OPS_DISK_CRITICAL_PERCENT ?? "97");
  return {
    warnPercent: Number.isFinite(warn) ? warn : 90,
    criticalPercent: Number.isFinite(critical) ? critical : 97,
  };
}

export function databaseWritable(db: SqliteHandle) {
  try {
    // 取一次写锁再回滚：证明可写，但不留下任何数据
    db.exec("BEGIN IMMEDIATE; ROLLBACK;");
    return { ok: true, detail: "write lock acquired" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "write_probe_failed" };
  }
}

export function evaluateReadiness(input: {
  db?: SqliteHandle;
  databasePath?: string;
  env?: Record<string, string | undefined>;
} = {}): { ready: boolean; checks: OpsCheck[] } {
  const env = input.env ?? process.env;
  const { file } = input.databasePath ? { file: input.databasePath } : resolveDatabasePaths(env);
  const checks: OpsCheck[] = [];
  const db = input.db;

  checks.push(db
    ? { id: "database.reachable", status: "pass", detail: "sqlite handle open" }
    : { id: "database.reachable", status: "fail", detail: "sqlite handle unavailable" });

  if (db) {
    const schema = readSchemaState(file);
    checks.push(schema.unknown.length === 0 && schema.duplicates.length === 0
      ? { id: "migrations.consistent", status: "pass", detail: `current=${schema.current ?? "none"} pending=${schema.pending.length}` }
      : { id: "migrations.consistent", status: "fail", detail: `unknown=${schema.unknown.join(",")} duplicates=${schema.duplicates.join(",")}` });
    const writable = databaseWritable(db);
    checks.push({ id: "store.writable", status: writable.ok ? "pass" : "fail", detail: writable.detail });
  } else {
    checks.push({ id: "migrations.consistent", status: "fail", detail: "database not reachable" });
    checks.push({ id: "store.writable", status: "fail", detail: "database not reachable" });
  }

  try {
    validateAuthEnv(env as NodeJS.ProcessEnv);
    checks.push({
      id: "auth.config",
      status: "pass",
      detail: isDemoMode(env as NodeJS.ProcessEnv) ? "demo mode" : "production AUTH_SECRET present",
    });
  } catch (error) {
    checks.push({ id: "auth.config", status: "fail", detail: error instanceof Error ? error.message : "auth_config_invalid" });
  }

  const configured = integrationConfiguration(env);
  const required = requiredIntegrations(env);
  for (const name of required) {
    const state = configured[name];
    checks.push(state === "configured"
      ? { id: `integration.${name}`, status: "pass", detail: "required and configured" }
      : { id: `integration.${name}`, status: "fail", detail: "required but unconfigured" });
  }

  const thresholds = diskThresholds(env);
  try {
    const disk = diskUsage(file);
    const status: OpsCheckStatus = disk.usedPercent >= thresholds.criticalPercent
      ? "fail"
      : disk.usedPercent >= thresholds.warnPercent ? "warn" : "pass";
    checks.push({
      id: "disk.capacity",
      status,
      detail: `used=${disk.usedPercent}% free=${Math.round(disk.freeBytes / 1048576)}MiB warn>=${thresholds.warnPercent} critical>=${thresholds.criticalPercent}`,
    });
  } catch (error) {
    checks.push({ id: "disk.capacity", status: "warn", detail: error instanceof Error ? error.message : "disk_probe_failed" });
  }

  return { ready: checks.every((check) => check.status !== "fail"), checks };
}

export function buildOpsStatus(input: {
  db?: SqliteHandle;
  databasePath?: string;
  env?: Record<string, string | undefined>;
  uptimeSeconds: number;
  startedAt?: string;
}) {
  const env = input.env ?? process.env;
  const paths = input.databasePath ? { file: input.databasePath } : resolveDatabasePaths(env);
  const db = input.db;
  const schema = db ? readSchemaState(paths.file) : null;
  let databaseSize = 0;
  try { databaseSize = statSync(paths.file).size; } catch { databaseSize = 0; }
  const disk = (() => {
    try {
      const usage = diskUsage(paths.file);
      return {
        usedPercent: usage.usedPercent,
        freeBytes: usage.freeBytes,
        thresholds: diskThresholds(env),
      };
    } catch {
      return null;
    }
  })();
  return {
    appVersion: applicationVersion(),
    uptimeSeconds: Math.round(input.uptimeSeconds),
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    schemaVersion: schema?.current ?? null,
    supportedSchemaVersion: schema?.supported ?? null,
    migrationStatus: schema
      ? { current: schema.current, pending: schema.pending, unknown: schema.unknown, duplicates: schema.duplicates }
      : { current: null, pending: [], unknown: [], duplicates: [] },
    databaseReachable: Boolean(db),
    databaseSizeBytes: databaseSize,
    databaseWritable: db ? databaseWritable(db).ok : false,
    integrationsConfigured: integrationConfiguration(env),
    requiredIntegrations: requiredIntegrations(env),
    disk,
    runtimeMode: isDemoMode(env as NodeJS.ProcessEnv) ? "demo" : "production",
  };
}
