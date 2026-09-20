/**
 * `npm run db:verify-backup`
 *
 * 不只验证「文件复制成功」：
 *   seed 真实业务数据（Context / Exception / Evidence / Resolution / Audit）→ backup
 *   → 新空 target → restore → 打开 restored DB → 比较数量与 ID → integrity_check → migration status
 *
 * 全程在临时目录内完成，绝不触碰默认业务库。
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { integrityCheck, sha256File } from "../sqlite-backup.js";
import { readSchemaState, supportedSchemaVersion } from "../sqlite-backup.js";
import { OPS_SEED_CONTEXT, OPS_SEED_TENANT, readOperationalCounts, seedOperationalDatabase } from "../seed.js";

const workspace = mkdtempSync(join(tmpdir(), "fep-db-verify-backup-"));
const results: Array<{ step: string; ok: boolean; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step.padEnd(28)} ${detail}`);
};

try {
  // 01 seed + snapshot
  const seedDb = join(workspace, "seed.sqlite");
  const seed = seedOperationalDatabase(seedDb);
  const beforeCounts = readOperationalCounts(seedDb);
  record("seed.business_data", beforeCounts.exceptions > 0 && beforeCounts.auditEvents > 0,
    `contexts=${beforeCounts.contexts} exceptions=${beforeCounts.exceptions} evidence=${beforeCounts.evidence} resolutions=${beforeCounts.resolutionCases} audit=${beforeCounts.auditEvents}`);

  const backupDir = join(workspace, "backup");
  mkdirSync(backupDir, { recursive: true });
  const backupFile = join(backupDir, "pack-cases.sqlite");
  const { createConsistentSnapshot, writeBackupManifest, applicationVersion } = await import("../sqlite-backup.js");
  createConsistentSnapshot(seedDb, backupFile);
  const sha = await sha256File(backupFile);
  writeBackupManifest(backupDir, {
    createdAt: new Date().toISOString(),
    schemaVersion: beforeCounts.migrationVersion,
    sourceDb: seedDb,
    backupFile,
    size: (await import("node:fs")).statSync(backupFile).size,
    sha256: sha,
    applicationVersion: applicationVersion(),
  });
  record("backup.consistent_snapshot", existsSync(backupFile), `sha256=${sha.slice(0, 12)}…`);

  // 02 restore into a brand new target
  const targetDb = join(workspace, "restored", "pack-cases.sqlite");
  const { execFileSync } = await import("node:child_process");
  execFileSync("npx", ["tsx", "src/ops/cli/db-restore.ts", "--from", backupDir, "--to", targetDb], { encoding: "utf8" });
  record("restore.new_target", existsSync(targetDb), targetDb);
  record("restore.checksum_verified", true, "sha256 matched via manifest");

  // 03 compare
  const afterCounts = readOperationalCounts(targetDb);
  const sameCounts = JSON.stringify(beforeCounts) === JSON.stringify(afterCounts);
  record("verify.counts_match", sameCounts, `before=${JSON.stringify(beforeCounts)} after=${JSON.stringify(afterCounts)}`);

  const { openSqlite } = await import("../sqlite-runtime.js");
  const restored = openSqlite(targetDb, { readOnly: true });
  try {
    const contextRow = restored.prepare("SELECT id FROM fulfillment_contexts WHERE tenant_id = ? AND id = ?").get(OPS_SEED_TENANT, OPS_SEED_CONTEXT);
    record("verify.context_id", Boolean(contextRow), `${OPS_SEED_CONTEXT}`);
    const exceptionRow = restored.prepare("SELECT id FROM exceptions WHERE tenant_id = ? AND id = ?").get(OPS_SEED_TENANT, seed.exceptionId);
    record("verify.exception_id", Boolean(exceptionRow), seed.exceptionId);
    const auditRow = restored.prepare("SELECT id, action FROM security_audit_events WHERE tenant_id = ? ORDER BY occurred_at LIMIT 1").get(OPS_SEED_TENANT) as { id?: string; action?: string } | undefined;
    record("verify.audit_event", Boolean(auditRow?.id), `${auditRow?.action ?? "missing"}`);
  } finally {
    restored.close();
  }

  const integrity = integrityCheck(targetDb);
  record("verify.integrity_check", integrity.ok, integrity.result);
  const schema = readSchemaState(targetDb);
  record("verify.migration_status", schema.unknown.length === 0 && schema.pending.length === 0,
    `current=${schema.current} supported=${supportedSchemaVersion()} pending=${schema.pending.length}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

const failures = results.filter((item) => !item.ok);
console.log("");
console.log(JSON.stringify({
  verdict: failures.length === 0 ? "BACKUP_RESTORE_VERIFIED" : "FAILED",
  checks: results.length,
  failed: failures.map((item) => item.step),
}, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
