/**
 * `npm run ops:recovery-drill`
 *
 * 01 seed isolated DB → 02 backup → 03 checksum → 04 破坏/删除工作副本 → 05 restore 到新库
 * → 06 用 restored DB 启动应用 → 07 health → 08 readiness → 09 context → 10 exception
 * → 11 evidence → 12 audit event → RECOVERY_DRILL_VERIFIED
 *
 * 强制临时目录：默认业务库（PACK_STORE_DB / data/）绝不被触碰；一旦解析出的路径不在
 * 临时工作区内，直接失败退出。
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openSqlite } from "../sqlite-runtime.js";
import { createConsistentSnapshot, integrityCheck, sha256File, writeBackupManifest } from "../sqlite-backup.js";
import { OPS_SEED_CONTEXT, OPS_SEED_TENANT, readOperationalCounts, seedOperationalDatabase } from "../seed.js";

const workspace = mkdtempSync(join(tmpdir(), "fep-recovery-drill-"));
const results: Array<{ step: string; ok: boolean; detail: string }> = [];
let child: ChildProcess | undefined;

function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step.padEnd(26)} ${detail}`);
}

function assertInsideWorkspace(path: string) {
  const resolved = resolve(path);
  if (!(resolved === resolve(workspace) || resolved.startsWith(resolve(workspace) + sep))) {
    throw new Error(`DRILL_PATH_OUTSIDE_WORKSPACE:${resolved}`);
  }
}

async function waitFor(url: string, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* not ready yet */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`DRILL_ENDPOINT_TIMEOUT:${url}`);
}

try {
  // 01 seed isolated DB
  const workingDb = join(workspace, "working", "pack-cases.sqlite");
  const seed = seedOperationalDatabase(workingDb);
  assertInsideWorkspace(workingDb);
  const before = readOperationalCounts(workingDb);
  record("01.seed", before.contexts > 0 && before.exceptions > 0, `exceptions=${before.exceptions} evidence=${before.evidence}`);

  // 02 backup
  const backupDir = join(workspace, "backup");
  mkdirSync(backupDir, { recursive: true });
  const backupFile = join(backupDir, "pack-cases.sqlite");
  createConsistentSnapshot(workingDb, backupFile);
  const sha = await sha256File(backupFile);
  writeBackupManifest(backupDir, {
    createdAt: new Date().toISOString(),
    schemaVersion: before.migrationVersion,
    sourceDb: workingDb,
    backupFile,
    size: statSync(backupFile).size,
    sha256: sha,
    applicationVersion: "0.1.0",
  });
  record("02.backup", existsSync(backupFile), `size=${statSync(backupFile).size}`);

  // 03 checksum
  record("03.checksum", (await sha256File(backupFile)) === sha, `sha256=${sha.slice(0, 12)}…`);

  // 04 破坏 / 删除工作副本（模拟磁盘事故）
  rmSync(join(workspace, "working"), { recursive: true, force: true });
  record("04.working_copy_lost", !existsSync(workingDb), "working copy removed");

  // 05 restore 到新库
  const restoredDb = join(workspace, "restored", "pack-cases.sqlite");
  assertInsideWorkspace(restoredDb);
  execFileSync("npx", ["tsx", "src/ops/cli/db-restore.ts", "--from", backupDir, "--to", restoredDb], { encoding: "utf8" });
  const integrity = integrityCheck(restoredDb);
  record("05.restore", existsSync(restoredDb) && integrity.ok, `integrity=${integrity.result}`);

  // 06 用 restored DB 启动应用（demo 模式，随机端口）
  const port = 37200 + (process.pid % 100);
  child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      DEMO_MODE: "true",
      PACK_STORE_DIR: join(workspace, "restored"),
      PACK_STORE_DB: restoredDb,
      LOG_LEVEL: "error",
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`);
  record("06.app_started_on_restored_db", true, base);

  // 07 health
  const health = await fetch(`${base}/api/health`);
  record("07.health", health.status === 200, `HTTP ${health.status}`);

  // 08 readiness
  const readyResponse = await fetch(`${base}/api/ready`);
  const readyBody = await readyResponse.json() as { ready?: boolean; checks?: unknown[] };
  record("08.readiness", readyResponse.status === 200 && readyBody.ready === true, `checks=${readyBody.checks?.length ?? 0}`);

  // 09-11 通过 HTTP 读回 context / exception / evidence
  const replay = await fetch(`${base}/api/v2/contexts/${OPS_SEED_CONTEXT}/replay`, { headers: { accept: "application/json", "x-tenant-id": OPS_SEED_TENANT, "x-actor": "viewer" } });
  const replayBody = await replay.json() as { context?: { id?: string }; evidence?: unknown[] };
  record("09.context", replay.status === 200 && replayBody.context?.id === OPS_SEED_CONTEXT, `evidence=${replayBody.evidence?.length ?? 0}`);

  const exceptions = await fetch(`${base}/api/v2/contexts/${OPS_SEED_CONTEXT}/exceptions`, { headers: { accept: "application/json", "x-tenant-id": OPS_SEED_TENANT, "x-actor": "viewer" } });
  const exceptionsBody = await exceptions.json() as { exceptions?: Array<{ id: string }> };
  const exceptionFound = Boolean(exceptionsBody.exceptions?.some((item) => item.id === seed.exceptionId));
  record("10.exception", exceptions.status === 200 && exceptionFound, `exceptions=${exceptionsBody.exceptions?.length ?? 0}`);

  const bundle = await fetch(`${base}/api/v2/contexts/${OPS_SEED_CONTEXT}/exceptions/${encodeURIComponent(seed.exceptionId)}/bundle`, { headers: { accept: "application/json", "x-tenant-id": OPS_SEED_TENANT, "x-actor": "viewer" } });
  const bundleBody = await bundle.json() as { evidence?: unknown[] };
  record("11.evidence", bundle.status === 200 && (bundleBody.evidence?.length ?? 0) > 0, `evidence=${bundleBody.evidence?.length ?? 0}`);

  // 12 audit event（直接对 restored 副本做 SQLite 读取校验）
  const restored = openSqlite(restoredDb, { readOnly: true });
  try {
    const audit = restored.prepare("SELECT id, action, subject_id FROM security_audit_events WHERE tenant_id = ? ORDER BY occurred_at LIMIT 1").get(OPS_SEED_TENANT) as { id?: string; action?: string; subject_id?: string } | undefined;
    record("12.audit_event", Boolean(audit?.id), `${audit?.action ?? "missing"} by ${audit?.subject_id ?? "-"}`);
  } finally {
    restored.close();
  }
} catch (error) {
  record("drill.exception", false, error instanceof Error ? error.message : "drill_failed");
} finally {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    if (!child.killed) child.kill("SIGKILL");
  }
  rmSync(workspace, { recursive: true, force: true });
}

const failures = results.filter((item) => !item.ok);
console.log("");
console.log(JSON.stringify({
  verdict: failures.length === 0 ? "RECOVERY_DRILL_VERIFIED" : "FAILED",
  steps: results.length,
  failed: failures.map((item) => item.step),
  workspace: "(temporary, removed)",
}, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
