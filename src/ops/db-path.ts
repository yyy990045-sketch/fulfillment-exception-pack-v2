/** 统一的 DB / 备份路径解析（CLI 与 server 共用同一套规则） */
import { join, resolve } from "node:path";

export function resolveDatabasePaths(env: Record<string, string | undefined> = process.env) {
  const rootDir = resolve(env.PACK_STORE_DIR || join(process.cwd(), "data", "pack-cases"));
  const file = resolve(env.PACK_STORE_DB || join(rootDir, "pack-cases.sqlite"));
  return { rootDir, file };
}

export function resolveBackupRoot(env: Record<string, string | undefined> = process.env) {
  return resolve(env.BACKUP_DIR || join(process.cwd(), "backups"));
}

export function backupTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
