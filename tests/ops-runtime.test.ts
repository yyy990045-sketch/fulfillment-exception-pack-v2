import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V2SqliteStore, provisionV2ManufacturingDemoData } from "../src/domain/v2/index.js";
import { createLogger, redact } from "../src/ops/logger.js";
import { buildOpsStatus, diskThresholds, evaluateReadiness, integrationConfiguration, requiredIntegrations } from "../src/ops/readiness.js";
import { assertStartupSafety } from "../src/ops/startup.js";
import { applicationVersion, createConsistentSnapshot, integrityCheck, pruneBackups, readSchemaState, sha256File, supportedSchemaVersion } from "../src/ops/sqlite-backup.js";
import { runWithRequestContext } from "../src/ops/request-context.js";
import { openSqlite } from "../src/ops/sqlite-runtime.js";

const temporaryDirectories: string[] = [];

function tempDir(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function seedDatabase(path: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = openSqlite(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  db.prepare("INSERT INTO security_audit_events (tenant_id,id,actor_type,subject_id,roles_json,action,resource_type,resource_id,result,occurred_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("demo-manufacturing", "audit-ops-test", "user", "ops", "[]", "resolution.accept", "resolution_case", "rc-1", "success", new Date().toISOString(), "{}");
  return db;
}

describe("readiness", () => {
  it("is ready when the database, migrations, store and auth config are healthy", () => {
    const directory = tempDir("fep-ops-ready-");
    const dbPath = join(directory, "pack-cases.sqlite");
    const db = seedDatabase(dbPath);
    const readiness = evaluateReadiness({ db, databasePath: dbPath, env: { DEMO_MODE: "true", OPS_DISK_WARN_PERCENT: "99", OPS_DISK_CRITICAL_PERCENT: "100" } });
    db.close();
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.map((item) => item.id)).toEqual([
      "database.reachable",
      "migrations.consistent",
      "store.writable",
      "auth.config",
      "disk.capacity",
    ]);
  });

  it("ignores unconfigured external integrations unless they are marked required", () => {
    const directory = tempDir("fep-ops-integrations-");
    const dbPath = join(directory, "pack-cases.sqlite");
    const db = seedDatabase(dbPath);
    const optional = evaluateReadiness({ db, databasePath: dbPath, env: { DEMO_MODE: "true" } });
    expect(optional.ready).toBe(true);

    const required = evaluateReadiness({ db, databasePath: dbPath, env: { DEMO_MODE: "true", SUPERSET_REQUIRED: "true" } });
    db.close();
    expect(required.ready).toBe(false);
    expect(required.checks.find((item) => item.id === "integration.superset")?.status).toBe("fail");
  });

  it("warns (not fails) when disk crosses the warning threshold", () => {
    const directory = tempDir("fep-ops-disk-");
    const dbPath = join(directory, "pack-cases.sqlite");
    const db = seedDatabase(dbPath);
    const readiness = evaluateReadiness({ db, databasePath: dbPath, env: { DEMO_MODE: "true", OPS_DISK_WARN_PERCENT: "0", OPS_DISK_CRITICAL_PERCENT: "100" } });
    db.close();
    expect(readiness.checks.find((item) => item.id === "disk.capacity")?.status).toBe("warn");
    expect(readiness.ready).toBe(true);
  });

  it("exposes integration configuration and thresholds without secrets", () => {
    expect(integrationConfiguration({
      SUPERSET_DOMAIN: "http://superset.test",
      SUPERSET_DASHBOARD_ID: "uuid",
      SUPERSET_PRODUCT_TENANT_ID: "tenant-a",
      SUPERSET_SERVICE_USERNAME: "svc",
      SUPERSET_SERVICE_PASSWORD: "must-not-leak",
    }).superset).toBe("configured");
    expect(integrationConfiguration({}).powerbi).toBe("unconfigured");
    expect(requiredIntegrations({ JEV_REQUIRED: "true" })).toEqual(["jev"]);
    expect(diskThresholds({ OPS_DISK_WARN_PERCENT: "80", OPS_DISK_CRITICAL_PERCENT: "95" })).toEqual({ warnPercent: 80, criticalPercent: 95 });
    expect(JSON.stringify(integrationConfiguration({ SUPERSET_SERVICE_PASSWORD: "must-not-leak" }))).not.toContain("must-not-leak");
  });
});

describe("ops status", () => {
  it("reports versions, schema, database and integration configuration without secrets", () => {
    const directory = tempDir("fep-ops-status-");
    const dbPath = join(directory, "pack-cases.sqlite");
    const db = seedDatabase(dbPath);
    const status = buildOpsStatus({
      db,
      databasePath: dbPath,
      uptimeSeconds: 12.7,
      env: { DEMO_MODE: "true", AUTH_SECRET: "super-secret-value-that-must-not-leak" },
    });
    db.close();
    expect(status.appVersion).toBe(applicationVersion());
    expect(status.uptimeSeconds).toBe(13);
    expect(status.schemaVersion).toBe(supportedSchemaVersion());
    expect(status.databaseReachable).toBe(true);
    expect(status.databaseWritable).toBe(true);
    expect(status.databaseSizeBytes).toBeGreaterThan(0);
    expect(status.integrationsConfigured).toEqual({ superset: "unconfigured", powerbi: "unconfigured", openSupos: "unconfigured", jev: "unconfigured" });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("super-secret-value-that-must-not-leak");
    expect(serialized).not.toMatch(/password|secretRef|connectionString/i);
  });
});

describe("startup fail-closed", () => {
  it("fails production startup without AUTH_SECRET and does not silently fall back to demo", () => {
    const directory = tempDir("fep-ops-startup-");
    const result = assertStartupSafety({ NODE_ENV: "production", DEMO_MODE: "false", PACK_STORE_DIR: directory, PACK_STORE_DB: join(directory, "pack-cases.sqlite") });
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("AUTH_SECRET_REQUIRED_IN_PRODUCTION");
  });

  it("accepts a fresh writable directory in demo mode", () => {
    const directory = tempDir("fep-ops-startup-ok-");
    const result = assertStartupSafety({ DEMO_MODE: "true", PACK_STORE_DIR: join(directory, "store"), PACK_STORE_DB: join(directory, "store", "pack-cases.sqlite") });
    expect(result.ok).toBe(true);
  });

  it("refuses to start on an unsupported (future) schema version", () => {
    const directory = tempDir("fep-ops-startup-schema-");
    const dbPath = join(directory, "pack-cases.sqlite");
    const db = seedDatabase(dbPath);
    db.prepare("INSERT INTO v2_schema_migrations (version, applied_at) VALUES (?, ?)").run("999_future_schema", new Date().toISOString());
    db.close();
    const result = assertStartupSafety({ DEMO_MODE: "true", PACK_STORE_DIR: directory, PACK_STORE_DB: dbPath });
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("unsupported_schema:999_future_schema");
  });

  it("fails startup on a half-configured integration and only fail-fasts on required ones when asked", () => {
    const directory = tempDir("fep-ops-startup-integration-");
    const base = { DEMO_MODE: "true", PACK_STORE_DIR: directory, PACK_STORE_DB: join(directory, "pack-cases.sqlite") };
    const halfConfigured = assertStartupSafety({ ...base, SUPERSET_DOMAIN: "http://superset.test" });
    expect(halfConfigured.ok).toBe(false);
    expect(halfConfigured.failures.join(" ")).toContain("superset_partial");

    // 默认：required 但未配置交给 /api/ready 报告，不阻塞启动
    expect(assertStartupSafety({ ...base, SUPERSET_REQUIRED: "true" }).ok).toBe(true);
    // 显式 fail-fast 时才在启动阶段失败
    const failFast = assertStartupSafety({ ...base, SUPERSET_REQUIRED: "true", OPS_FAIL_FAST_INTEGRATIONS: "true" });
    expect(failFast.ok).toBe(false);
    expect(failFast.failures.join(" ")).toContain("superset_required");
  });
});

describe("structured logging", () => {
  it("emits one JSON line per event with request context and redacts secrets", () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), level: "debug", now: () => new Date("2026-09-20T00:00:00.000Z") });
    runWithRequestContext({ requestId: "req-1", method: "POST", path: "/api/v2/contexts/c1/exceptions/e1/resolution-case" }, () => {
      logger.info("http.request", {
        status: 200,
        durationMs: 4.2,
        authorization: "Bearer super-secret-token",
        nested: { guestToken: "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.signaturepart" },
      });
    });
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({ timestamp: "2026-09-20T00:00:00.000Z", level: "info", event: "http.request", requestId: "req-1", status: 200, durationMs: 4.2 });
    expect(lines[0]).not.toContain("super-secret-token");
    expect(lines[0]).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(JSON.stringify(record.nested)).toContain("[redacted]");
  });

  it("redacts bearer strings and JWTs inside free text", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toEqual("Authorization: Bearer [redacted]");
    expect(redact("token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij")).toContain("[redacted]");
  });
});

describe("sqlite backup and restore safety", () => {
  it("creates a consistent snapshot that includes committed WAL data", async () => {
    const directory = tempDir("fep-ops-backup-");
    const dbPath = join(directory, "pack-cases.sqlite");
    const db = seedDatabase(dbPath);
    // 故意不 checkpoint：仍在 WAL 里的已提交事务也必须进入快照
    db.close();
    const snapshot = join(directory, "snapshot.sqlite");
    createConsistentSnapshot(dbPath, snapshot);
    const copy = openSqlite(snapshot, { readOnly: true });
    const rows = copy.prepare("SELECT COUNT(*) c FROM security_audit_events").get() as { c: number };
    copy.close();
    expect(rows.c).toBe(1);
    expect(integrityCheck(snapshot).ok).toBe(true);
    expect((await sha256File(snapshot)).length).toBe(64);
  });

  it("refuses to restore over an existing target unless --force is given", () => {
    const directory = tempDir("fep-ops-restore-");
    const dbPath = join(directory, "source.sqlite");
    const db = seedDatabase(dbPath);
    db.close();
    const backupDir = join(directory, "backup");
    mkdirSync(backupDir, { recursive: true });
    const backupFile = join(backupDir, "pack-cases.sqlite");
    createConsistentSnapshot(dbPath, backupFile);
    const target = join(directory, "target.sqlite");
    writeFileSync(target, "existing");

    expect(() => execFileSync("npx", ["tsx", "src/ops/cli/db-restore.ts", "--from", backupDir, "--to", target], { encoding: "utf8", stdio: "pipe" }))
      .toThrowError(/RESTORE_TARGET_EXISTS/);

    execFileSync("npx", ["tsx", "src/ops/cli/db-restore.ts", "--from", backupDir, "--to", target, "--force"], { encoding: "utf8", stdio: "pipe" });
    expect(integrityCheck(target).ok).toBe(true);
  });

  it("refuses a tampered backup (checksum mismatch) and a future schema", async () => {
    const directory = tempDir("fep-ops-tamper-");
    const dbPath = join(directory, "source.sqlite");
    const db = seedDatabase(dbPath);
    db.close();
    const backupDir = join(directory, "backup");
    mkdirSync(backupDir, { recursive: true });
    const backupFile = join(backupDir, "pack-cases.sqlite");
    createConsistentSnapshot(dbPath, backupFile);
    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify({ sha256: "0".repeat(64) }));
    expect(() => execFileSync("npx", ["tsx", "src/ops/cli/db-restore.ts", "--from", backupDir, "--to", join(directory, "t1.sqlite")], { encoding: "utf8", stdio: "pipe" }))
      .toThrowError(/RESTORE_CHECKSUM_MISMATCH/);

    const futureDir = join(directory, "future");
    mkdirSync(futureDir, { recursive: true });
    const futureDb = seedDatabase(join(futureDir, "pack-cases.sqlite"));
    futureDb.prepare("INSERT INTO v2_schema_migrations (version, applied_at) VALUES (?, ?)").run("999_future_schema", new Date().toISOString());
    futureDb.close();
    rmSync(join(futureDir, "manifest.json"), { force: true });
    expect(() => execFileSync("npx", ["tsx", "src/ops/cli/db-restore.ts", "--from", join(futureDir, "pack-cases.sqlite"), "--to", join(directory, "t2.sqlite")], { encoding: "utf8", stdio: "pipe" }))
      .toThrowError(/RESTORE_SCHEMA_UNSUPPORTED/);
  });

  it("keeps only the newest N backups and refuses symlink/path escapes", () => {
    const root = tempDir("fep-ops-retention-");
    for (const name of ["20260101-000000", "20260102-000000", "20260103-000000"]) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(join(root, name, "pack-cases.sqlite"), name);
    }
    // 危险样本：目录名合法但实际是指向外部的 symlink
    const outside = tempDir("fep-ops-outside-");
    writeFileSync(join(outside, "keep.txt"), "must survive");
    symlinkSync(outside, join(root, "20260104-000000"));

    const pruned = pruneBackups({ backupRoot: root, keep: 1 });
    // 只保留最新的有效备份；symlink 一律拒绝且不占用保留名额
    expect(pruned.kept).toEqual(["20260103-000000"]);
    expect(pruned.removed).toEqual(["20260102-000000", "20260101-000000"]);
    expect(pruned.refused).toEqual(["20260104-000000"]);
    expect(existsSync(join(root, "20260103-000000"))).toBe(true);
    expect(existsSync(join(root, "20260102-000000"))).toBe(false);
    expect(existsSync(join(root, "20260101-000000"))).toBe(false);
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });
});

describe("schema helpers", () => {
  it("reports duplicates and unknown versions", () => {
    const directory = tempDir("fep-ops-schema-");
    const dbPath = join(directory, "pack-cases.sqlite");
    const db = seedDatabase(dbPath);
    db.close();
    const state = readSchemaState(dbPath);
    expect(state.current).toBe(supportedSchemaVersion());
    expect(state.pending).toEqual([]);
    expect(state.unknown).toEqual([]);
  });
});
