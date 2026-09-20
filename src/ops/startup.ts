/**
 * 生产启动前的 fail-closed 检查。
 *
 * 任何核心条件不满足 → 调用方必须 exit non-zero。
 * 明确禁止：启动后才随机报错、静默 fallback 到 demo、自动清空 DB。
 */
import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { isDemoMode, validateAuthEnv } from "../auth.js";
import { resolveDatabasePaths } from "./db-path.js";
import { readSchemaState, supportedSchemaVersion } from "./sqlite-backup.js";
import type { OpsCheck } from "./readiness.js";

export type StartupCheckResult = {
  ok: boolean;
  checks: OpsCheck[];
  failures: string[];
};

export function assertStartupSafety(
  env: Record<string, string | undefined> = process.env,
  options: { createDirectories?: boolean } = {},
): StartupCheckResult {
  const checks: OpsCheck[] = [];
  const failures: string[] = [];
  const fail = (id: string, detail: string) => {
    checks.push({ id, status: "fail", detail });
    failures.push(`${id}:${detail}`);
  };
  const pass = (id: string, detail: string) => checks.push({ id, status: "pass", detail });

  // 1. 生产鉴权配置
  try {
    validateAuthEnv(env as NodeJS.ProcessEnv);
    pass("startup.auth", isDemoMode(env as NodeJS.ProcessEnv) ? "demo mode" : "AUTH_SECRET validated");
  } catch (error) {
    fail("startup.auth", error instanceof Error ? error.message : "auth_config_invalid");
  }

  // 2. 数据库目录与写权限（不自动清空、不自动重建）
  const paths = resolveDatabasePaths(env);
  try {
    if (!existsSync(paths.rootDir)) {
      if (options.createDirectories === false) fail("startup.db_dir", `missing:${paths.rootDir}`);
      else { mkdirSync(paths.rootDir, { recursive: true }); pass("startup.db_dir", `created:${paths.rootDir}`); }
    } else {
      pass("startup.db_dir", `exists:${paths.rootDir}`);
    }
    const probeDir = existsSync(paths.rootDir) ? paths.rootDir : dirname(paths.rootDir);
    accessSync(probeDir, constants.W_OK);
    pass("startup.db_writable", `writable:${probeDir}`);
  } catch (error) {
    fail("startup.db_writable", error instanceof Error ? error.message : "db_dir_not_writable");
  }

  // 3. migration 状态：只能在已知版本上 forward migrate，不认识更高版本必须拒绝启动
  if (existsSync(paths.file)) {
    try {
      const schema = readSchemaState(paths.file);
      if (schema.duplicates.length) fail("startup.migrations", `duplicate:${schema.duplicates.join(",")}`);
      else if (schema.unknown.length) fail("startup.migrations", `unsupported_schema:${schema.unknown.join(",")} (app supports up to ${supportedSchemaVersion()})`);
      else pass("startup.migrations", `current=${schema.current ?? "none"} pending=${schema.pending.length} (forward-only)`);
    } catch (error) {
      fail("startup.migrations", error instanceof Error ? error.message : "migration_probe_failed");
    }
  } else {
    pass("startup.migrations", "fresh database will be initialized forward-only");
  }

  // 4. 备份目录（可选但必须可写；缺失时创建）
  if (env.BACKUP_DIR) {
    try {
      mkdirSync(env.BACKUP_DIR, { recursive: true });
      accessSync(env.BACKUP_DIR, constants.W_OK);
      pass("startup.backup_dir", `writable:${env.BACKUP_DIR}`);
    } catch (error) {
      fail("startup.backup_dir", error instanceof Error ? error.message : "backup_dir_not_writable");
    }
  }

  // 5. 集成配置：
  //    a) 半配置（配了一半）永远是配置错误 → 启动失败
  //    b) 显式 REQUIRED=true 但未配置 → 默认交给 /api/ready 报告；
  //       只有 OPS_FAIL_FAST_INTEGRATIONS=true 时才在启动阶段直接失败
  const partial = (keys: string[]) => {
    const present = keys.filter((key) => Boolean(env[key]));
    return present.length > 0 && present.length < keys.length ? present : null;
  };
  const supersetKeys = ["SUPERSET_DOMAIN", "SUPERSET_DASHBOARD_ID", "SUPERSET_PRODUCT_TENANT_ID", "SUPERSET_SERVICE_USERNAME", "SUPERSET_SERVICE_PASSWORD"];
  const powerbiKeys = ["POWERBI_TENANT_ID", "POWERBI_PRODUCT_TENANT_ID", "POWERBI_CLIENT_ID", "POWERBI_CLIENT_SECRET", "POWERBI_WORKSPACE_ID", "POWERBI_REPORT_ID"];
  const supersetPartial = partial(supersetKeys);
  const powerbiPartial = partial(powerbiKeys);
  if (supersetPartial) fail("startup.integration.superset_partial", `incomplete Superset config: ${supersetPartial.join(",")}`);
  else pass("startup.integration.superset", "not partially configured");
  if (powerbiPartial) fail("startup.integration.powerbi_partial", `incomplete Power BI config: ${powerbiPartial.join(",")}`);
  if (env.OPEN_SUPOS_ENABLED === "true" && !(env.OPEN_SUPOS_MQTT_URL || env.OPEN_SUPOS_BASE_URL)) {
    fail("startup.integration.openSupos_partial", "OPEN_SUPOS_ENABLED=true but no MQTT/UNS endpoint configured");
  }
  if (env.JEV_ENABLED === "true" && !env.JEV_BASE_URL) {
    fail("startup.integration.jev_partial", "JEV_ENABLED=true but JEV_BASE_URL missing");
  }
  if (env.OPS_FAIL_FAST_INTEGRATIONS === "true") {
    if (env.SUPERSET_REQUIRED === "true" && !supersetPartial && !(env.SUPERSET_DOMAIN && env.SUPERSET_DASHBOARD_ID)) {
      fail("startup.integration.superset_required", "SUPERSET_REQUIRED=true but Superset is unconfigured");
    }
    if (env.POWERBI_REQUIRED === "true" && !(env.POWERBI_TENANT_ID && env.POWERBI_CLIENT_ID)) {
      fail("startup.integration.powerbi_required", "POWERBI_REQUIRED=true but Power BI is unconfigured");
    }
    if (env.OPEN_SUPOS_REQUIRED === "true" && env.OPEN_SUPOS_ENABLED !== "true") {
      fail("startup.integration.openSupos_required", "OPEN_SUPOS_REQUIRED=true but open supOS is disabled");
    }
    if (env.JEV_REQUIRED === "true" && env.JEV_ENABLED !== "true") {
      fail("startup.integration.jev_required", "JEV_REQUIRED=true but Jev is disabled");
    }
  }

  // 6. 已有的 DB 文件大小非 0（0 字节通常意味着上一次异常中断）
  if (existsSync(paths.file) && statSync(paths.file).size === 0) {
    fail("startup.db_size", `database file is empty:${paths.file}`);
  }

  return { ok: failures.length === 0, checks, failures };
}
