import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { V2SqliteStore } from "./sqlite-store.js";
import type { SqliteDatabaseLike } from "./sqlite-migrations.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };

export function openV2SqliteStore(): V2SqliteStore {
  const rootDir = process.env.PACK_STORE_DIR || join(process.cwd(), "data", "pack-cases");
  const file = process.env.PACK_STORE_DB || join(rootDir, "pack-cases.sqlite");
  mkdirSync(dirname(file), { recursive: true });
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
  const database = new builtin.DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return new V2SqliteStore(database);
}
