/**
 * SQLite 一致性快照 / 校验 / 保留策略。
 *
 * 关键约束：业务库使用 WAL，直接 `cp` 单个 .sqlite 文件会漏掉未 checkpoint 的已提交事务。
 * 这里统一使用 SQLite 自身的 `VACUUM INTO` 生成一致性快照，并对快照做 sha256 与
 * `PRAGMA integrity_check`。
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { openSqlite } from "./sqlite-runtime.js";
import { V2_MIGRATIONS } from "../domain/v2/sqlite-migrations.js";

export type SchemaState = {
  supported: string;
  current: string | null;
  applied: string[];
  pending: string[];
  unknown: string[];
  duplicates: string[];
};

export function supportedSchemaVersion() {
  const versions = [...V2_MIGRATIONS].map((item) => item.version).sort((left, right) => left.localeCompare(right));
  return versions[versions.length - 1]!;
}

export function readSchemaState(databasePath: string, migrations = V2_MIGRATIONS): SchemaState {
  const duplicates = migrations.map((item) => item.version)
    .filter((version, index, all) => all.indexOf(version) !== index);
  const known = new Set(migrations.map((item) => item.version));
  const db = openSqlite(databasePath);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_schema_migrations'").get();
    if (!table) {
      return {
        supported: supportedSchemaVersion(),
        current: null,
        applied: [],
        pending: migrations.map((item) => item.version).sort(),
        unknown: [],
        duplicates,
      };
    }
    const applied = (db.prepare("SELECT version FROM v2_schema_migrations").all() as Array<{ version: string }>)
      .map((row) => row.version)
      .sort((left, right) => left.localeCompare(right));
    const appliedSet = new Set(applied);
    return {
      supported: supportedSchemaVersion(),
      current: applied.length ? applied[applied.length - 1]! : null,
      applied,
      pending: migrations.map((item) => item.version).filter((version) => !appliedSet.has(version)).sort(),
      unknown: applied.filter((version) => !known.has(version)),
      duplicates,
    };
  } finally {
    db.close();
  }
}

export function sha256File(path: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

export function integrityCheck(path: string) {
  const db = openSqlite(path);
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const result = row?.integrity_check ?? "unknown";
    return { ok: result === "ok", result };
  } catch (error) {
    return { ok: false, result: error instanceof Error ? error.message : "integrity_check_failed" };
  } finally {
    db.close();
  }
}

/** 用 SQLite 自身机制创建一致性快照（WAL 下唯一安全的拷库方式） */
export function createConsistentSnapshot(sourcePath: string, targetPath: string) {
  if (!existsSync(sourcePath)) throw new Error(`DB_SOURCE_MISSING:${sourcePath}`);
  if (resolve(sourcePath) === resolve(targetPath)) throw new Error("DB_SNAPSHOT_SAME_PATH");
  if (existsSync(targetPath)) throw new Error(`DB_SNAPSHOT_TARGET_EXISTS:${targetPath}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  const source = openSqlite(sourcePath, { readOnly: true });
  try {
    // 只读打开也能取到“已 checkpoint + WAL 中已提交”的一致视图
    source.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }
  const check = integrityCheck(targetPath);
  if (!check.ok) throw new Error(`DB_SNAPSHOT_INTEGRITY_FAILED:${check.result}`);
  return { targetPath, size: statSync(targetPath).size };
}

export function applicationVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 备份保留策略。安全规则：
 *   - 只允许删除 backupRoot 的直接子目录（形如 YYYYMMDD-HHMMSS）
 *   - 目录必须真实位于 backupRoot 内（realpath 校验，防止 symlink 逃逸）
 *   - 不做递归删除，只删我们自己的备份目录
 */
export function pruneBackups(input: {
  backupRoot: string;
  keep: number;
  remove?: (path: string) => void;
}): { kept: string[]; removed: string[]; refused: string[] } {
  const root = resolve(input.backupRoot);
  if (!existsSync(root)) return { kept: [], removed: [], refused: [] };
  const realRoot = realpathSync(root);
  const names = readdirSync(root).filter((name) => /^\d{8}-\d{6}$/.test(name)).sort().reverse();
  const valid: Array<{ name: string; realPath: string }> = [];
  const refused: string[] = [];
  for (const name of names) {
    const target = resolve(root, name);
    // 物理路径校验：必须真实位于 backupRoot 内，且就是同名目录（symlink 指向外部会被拒绝）
    let realTarget: string;
    try { realTarget = realpathSync(target); } catch { refused.push(name); continue; }
    if (!realTarget.startsWith(realRoot + sep) || basename(realTarget) !== name) { refused.push(name); continue; }
    try {
      if (!statSync(realTarget).isDirectory()) { refused.push(name); continue; }
    } catch { refused.push(name); continue; }
    valid.push({ name, realPath: realTarget });
  }
  const keep = Math.max(input.keep, 0);
  const kept = valid.slice(0, keep).map((entry) => entry.name);
  const removed: string[] = [];
  for (const entry of valid.slice(keep)) {
    if (input.remove) input.remove(entry.realPath);
    else rmSync(entry.realPath, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return { kept, removed, refused };
}

export function writeBackupManifest(directory: string, manifest: Record<string, unknown>) {
  const path = join(directory, "manifest.json");
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path;
}
