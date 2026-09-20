/**
 * `npm run db:restore -- --from <backup> --to <targetDb> [--force]`
 *
 * 安全规则：
 *   - 必须显式给出 backup 与 target
 *   - target 已存在时默认拒绝，必须 --force 才覆盖
 *   - 校验 manifest 里的 sha256
 *   - 校验 SQLite integrity_check
 *   - 不允许恢复到高于当前应用支持的 schema（避免降级/未知结构）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { integrityCheck, readSchemaState, sha256File, supportedSchemaVersion } from "../sqlite-backup.js";
import { resolveDatabasePaths } from "../db-path.js";

const argv = process.argv.slice(2);
const fromIndex = argv.indexOf("--from");
const toIndex = argv.indexOf("--to");
const force = argv.includes("--force");

function fail(code: string, detail: string): never {
  console.error(JSON.stringify({ error: code, detail }));
  process.exit(2);
}

const from = fromIndex >= 0 ? argv[fromIndex + 1] : undefined;
const to = toIndex >= 0 ? argv[toIndex + 1] : undefined;
if (!from || !to) fail("RESTORE_ARGUMENTS_REQUIRED", "usage: db:restore -- --from <backupDir|backupFile> --to <targetDb> [--force]");

const resolvedFrom = resolve(from!);
if (!existsSync(resolvedFrom)) fail("RESTORE_BACKUP_MISSING", resolvedFrom);

const backupFile = statSync(resolvedFrom).isDirectory()
  ? (() => {
    const candidate = join(resolvedFrom, "pack-cases.sqlite");
    if (existsSync(candidate)) return candidate;
    const sqlite = readdirSync(resolvedFrom).find((name) => name.endsWith(".sqlite"));
    return sqlite ? join(resolvedFrom, sqlite) : null;
  })()
  : resolvedFrom;
if (!backupFile) fail("RESTORE_BACKUP_FILE_MISSING", resolvedFrom);

const target = resolve(to!);
const defaultTarget = resolveDatabasePaths(process.env).file;
if (target === backupFile) fail("RESTORE_TARGET_EQUALS_SOURCE", target);
if (existsSync(target) && !force) {
  fail("RESTORE_TARGET_EXISTS", `${target} (use --force to overwrite; default database is ${defaultTarget})`);
}

// 1) integrity_check（源）
const sourceIntegrity = integrityCheck(backupFile);
if (!sourceIntegrity.ok) fail("RESTORE_BACKUP_INTEGRITY_FAILED", sourceIntegrity.result);

// 2) schema 版本不得高于当前应用支持
const schema = readSchemaState(backupFile);
const supported = supportedSchemaVersion();
if (schema.unknown.length || (schema.current && schema.current.localeCompare(supported) > 0)) {
  fail("RESTORE_SCHEMA_UNSUPPORTED", `backup=${schema.current} supported=${supported} unknown=${schema.unknown.join(",")}`);
}

// 3) sha256（有 manifest 时强校验）
const manifestPath = join(dirname(backupFile), "manifest.json");
let expectedSha: string | null = null;
if (existsSync(manifestPath)) {
  try {
    expectedSha = (JSON.parse(readFileSync(manifestPath, "utf8")) as { sha256?: string }).sha256 ?? null;
  } catch {
    fail("RESTORE_MANIFEST_UNREADABLE", manifestPath);
  }
}
const actualSha = await sha256File(backupFile);
if (expectedSha && expectedSha !== actualSha) fail("RESTORE_CHECKSUM_MISMATCH", `expected=${expectedSha} actual=${actualSha}`);

// 4) 复制到 target 并复检
mkdirSync(dirname(target), { recursive: true });
copyFileSync(backupFile, target);
const restoredIntegrity = integrityCheck(target);
if (!restoredIntegrity.ok) fail("RESTORE_TARGET_INTEGRITY_FAILED", restoredIntegrity.result);
const restoredSchema = readSchemaState(target);

console.log(JSON.stringify({
  restored: true,
  from: backupFile,
  to: target,
  checksum: { expected: expectedSha, actual: actualSha, verified: Boolean(expectedSha) },
  integrity: restoredIntegrity.result,
  schemaVersion: restoredSchema.current,
  supportedSchemaVersion: supported,
  pendingMigrations: restoredSchema.pending,
  note: "restore 后首次打开会 forward migrate；不会 downgrade",
}, null, 2));
