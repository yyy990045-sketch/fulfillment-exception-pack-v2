/**
 * node:sqlite 的运行时句柄封装。
 *
 * 仓库统一用 `process.getBuiltinModule("node:sqlite")` 而不是静态 import，
 * 这样在 vitest/vite 解析环境下也能正常工作（与 runtime-store.ts 保持一致）。
 */
export type SqliteStatementLike = {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
};

export type SqliteHandle = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
};

type DatabaseSyncConstructor = new (path: string, options?: { readOnly?: boolean }) => SqliteHandle;

export function openSqlite(path: string, options: { readOnly?: boolean } = {}): SqliteHandle {
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
  return new builtin.DatabaseSync(path, options);
}
