/**
 * `npm run db:backup`
 *
 * 输出：
 *   backups/YYYYMMDD-HHMMSS/pack-cases.sqlite
 *   backups/YYYYMMDD-HHMMSS/manifest.json
 *
 * 使用 SQLite `VACUUM INTO` 取一致性快照（WAL 下不能直接 cp 单文件），
 * 并记录 sha256 / size / schemaVersion / applicationVersion。
 * manifest 不含任何 credential。
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { backupTimestamp, resolveBackupRoot, resolveDatabasePaths } from "../db-path.js";
import { applicationVersion, createConsistentSnapshot, pruneBackups, readSchemaState, sha256File, writeBackupManifest } from "../sqlite-backup.js";

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const env = process.env;
const paths = resolveDatabasePaths(env);
const backupRoot = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1]! : resolveBackupRoot(env);

if (!existsSync(paths.file)) {
  console.error(JSON.stringify({ error: "DB_SOURCE_MISSING", database: paths.file }));
  process.exit(2);
}

const directory = join(backupRoot, backupTimestamp());
mkdirSync(directory, { recursive: true });
const target = join(directory, "pack-cases.sqlite");
createConsistentSnapshot(paths.file, target);
const sha256 = await sha256File(target);
const schema = readSchemaState(paths.file);
const manifest = {
  createdAt: new Date().toISOString(),
  schemaVersion: schema.current,
  sourceDb: paths.file,
  backupFile: target,
  size: statSync(target).size,
  sha256,
  applicationVersion: applicationVersion(),
};
const manifestPath = writeBackupManifest(directory, manifest);

const retention = Number(env.BACKUP_RETENTION_COUNT ?? "7");
const pruned = Number.isFinite(retention) && retention >= 0
  ? pruneBackups({ backupRoot, keep: retention })
  : { kept: [], removed: [], refused: [] };

console.log(JSON.stringify({
  backupDirectory: directory,
  backupFile: target,
  manifest: manifestPath,
  size: manifest.size,
  sha256,
  schemaVersion: manifest.schemaVersion,
  applicationVersion: manifest.applicationVersion,
  retention: { configured: retention, removed: pruned.removed, refused: pruned.refused },
}, null, 2));
