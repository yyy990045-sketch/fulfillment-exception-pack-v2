/**
 * `npm run db:migrate` / `npm run db:migrate:status`
 *
 * 只做 forward migration：不会 downgrade、不会删数据、不会重建 DB。
 * 若目标库存在且有 pending migration，会先落一份一致性备份（可用 --skip-backup 跳过）。
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openSqlite } from "../sqlite-runtime.js";
import { runV2Migrations } from "../../domain/v2/sqlite-migrations.js";
import { resolveBackupRoot, resolveDatabasePaths, backupTimestamp } from "../db-path.js";
import { createConsistentSnapshot, readSchemaState, sha256File, supportedSchemaVersion, writeBackupManifest, applicationVersion } from "../sqlite-backup.js";
import { join } from "node:path";

const argv = process.argv.slice(2);
const statusOnly = argv.includes("--status");
const skipBackup = argv.includes("--skip-backup");
const env = process.env;
const paths = resolveDatabasePaths(env);

async function createMigrationBackup() {
  const directory = join(resolveBackupRoot(env), backupTimestamp());
  mkdirSync(directory, { recursive: true });
  const target = join(directory, "pack-cases.sqlite");
  createConsistentSnapshot(paths.file, target);
  const sha256 = await sha256File(target);
  const schema = readSchemaState(paths.file);
  writeBackupManifest(directory, {
    createdAt: new Date().toISOString(),
    reason: "pre-migration",
    schemaVersion: schema.current,
    sourceDb: paths.file,
    backupFile: target,
    size: (await import("node:fs")).statSync(target).size,
    sha256,
    applicationVersion: applicationVersion(),
  });
  return { directory, target, sha256 };
}

async function main() {
  const before = existsSync(paths.file)
    ? readSchemaState(paths.file)
    : { current: null, pending: [], applied: [], unknown: [], duplicates: [], supported: supportedSchemaVersion() };

  if (statusOnly) {
    console.log(JSON.stringify({
      database: paths.file,
      exists: existsSync(paths.file),
      supportedSchemaVersion: supportedSchemaVersion(),
      currentSchemaVersion: before.current,
      applied: before.applied,
      pending: before.pending,
      unknown: before.unknown,
      duplicates: before.duplicates,
      forwardOnly: true,
    }, null, 2));
    const broken = before.unknown.length > 0 || before.duplicates.length > 0;
    process.exit(broken ? 1 : 0);
  }

  mkdirSync(dirname(paths.file), { recursive: true });
  let backup: { directory: string; target: string; sha256: string } | null = null;
  if (existsSync(paths.file) && before.pending.length > 0 && !skipBackup) {
    backup = await createMigrationBackup();
  }

  const db = openSqlite(paths.file);
  let applied: string[] = [];
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    applied = runV2Migrations(db);
  } finally {
    db.close();
  }
  const after = readSchemaState(paths.file);
  console.log(JSON.stringify({
    database: paths.file,
    applied,
    backup: backup ? { directory: backup.directory, sha256: backup.sha256 } : null,
    schemaVersion: after.current,
    supportedSchemaVersion: supportedSchemaVersion(),
    pending: after.pending,
    unknown: after.unknown,
    forwardOnly: true,
  }, null, 2));
  process.exit(after.unknown.length > 0 || after.duplicates.length > 0 ? 1 : 0);
}

await main();
