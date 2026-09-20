/**
 * `npm run db:restore -- --from <backup> --to <targetDb> [--force]`
 *
 * 安全规则：
 *   - 必须显式给出 backup 与 target
 *   - target 已存在时默认拒绝，必须 --force 才覆盖
 *   - 校验 manifest 里的 sha256
 *   - 校验 SQLite integrity_check
 *   - 不允许恢复到高于当前应用支持的 schema（避免降级/未知结构）
 *   - 清除目标侧的 WAL/SHM 旁文件：否则旧 `-wal` 会在打开时覆盖刚恢复出来的数据，
 *     表现为「恢复成功但读到的还是恢复前的旧数据」（见下方 removeSidecars 注释）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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

/**
 * 删除某个 SQLite 主文件旁边的 `-wal` / `-shm`。
 *
 * 为什么必须做：业务库跑在 WAL 模式。若目标位置残留着旧库的 `-wal`（例如上次异常退出、
 * 或恢复时服务仍在运行），那么把备份主文件覆盖上去之后，SQLite 下次打开时会把**旧 WAL
 * 里的页**重放到新主文件上。结果是：命令报 `restored: true`、`integrity_check` 也是 `ok`，
 * 但读出来的是恢复之前的旧数据——恢复静默失败。删掉旁文件后，主文件才是唯一事实来源。
 */
function removeSidecars(databasePath: string) {
  const removed: string[] = [];
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) {
      rmSync(sidecar, { force: true });
      removed.push(sidecar);
    }
  }
  return removed;
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

// 备份本身若带着 `-wal`，说明它不是一致性快照：只复制主文件会丢掉 WAL 里的已提交事务。
// 这种「备份」必须拒绝，而不是悄悄恢复出一份缺数据的库。
const backupSidecar = `${backupFile}-wal`;
if (existsSync(backupSidecar) && statSync(backupSidecar).size > 0) {
  fail("RESTORE_BACKUP_HAS_STALE_WAL", `${backupSidecar} (not a consistent snapshot; take the backup with VACUUM INTO / npm run db:backup)`);
}

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

// 4) 清除目标侧旁文件 → 复制 → 复检
//    顺序很关键：必须先删 `-wal` / `-shm`，否则旧 WAL 会在打开时重放到新主文件上，
//    恢复会「成功」但读到旧数据。
mkdirSync(dirname(target), { recursive: true });
const targetSidecarsRemoved = removeSidecars(target);
copyFileSync(backupFile, target);
removeSidecars(target);

const restoredSha = await sha256File(target);
if (restoredSha !== actualSha) {
  fail("RESTORE_COPY_INCOMPLETE", `target=${restoredSha} backup=${actualSha}`);
}
const restoredIntegrity = integrityCheck(target);
if (!restoredIntegrity.ok) fail("RESTORE_TARGET_INTEGRITY_FAILED", restoredIntegrity.result);
removeSidecars(target);
const restoredSchema = readSchemaState(target);

console.log(JSON.stringify({
  restored: true,
  from: backupFile,
  to: target,
  checksum: { expected: expectedSha, actual: actualSha, verified: Boolean(expectedSha) },
  targetChecksumMatches: true,
  targetSidecarsRemoved,
  integrity: restoredIntegrity.result,
  schemaVersion: restoredSchema.current,
  supportedSchemaVersion: supported,
  pendingMigrations: restoredSchema.pending,
  note: "restore 后首次打开会 forward migrate；不会 downgrade",
}, null, 2));
