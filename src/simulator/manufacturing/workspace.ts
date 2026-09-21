/**
 * 隔离的仿真工作区。
 *
 * 仿真绝不写进既有演示库（`data/pack-cases`）：每次运行都从一个**全新空库**开始，
 * 因此「异常数量 = 0」这类断言不会因为历史数据而变成假象。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { V2SqliteStore, type SqliteDatabaseLike } from "../../domain/v2/index.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };

export const DEFAULT_SIMULATION_WORKSPACE = ".preview/industrial-demo";

export type SimulationWorkspace = {
  rootDir: string;
  databasePath: string;
  store: V2SqliteStore;
  artifactsDir: string;
  close: () => void;
  writeArtifact: (name: string, content: string) => string;
};

export function openIsolatedSimulationWorkspace(rootDir = DEFAULT_SIMULATION_WORKSPACE): SimulationWorkspace {
  const absoluteRoot = resolve(rootDir);
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("SIMULATOR_REQUIRES_NODE_22_5_OR_NEWER");
  // 01 reset isolated demo workspace：先清空再建，保证每次都是同一份起点
  rmSync(absoluteRoot, { recursive: true, force: true });
  mkdirSync(absoluteRoot, { recursive: true });
  const artifactsDir = join(absoluteRoot, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const databasePath = join(absoluteRoot, "pack-cases.sqlite");
  const database = new builtin.DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return {
    rootDir: absoluteRoot,
    databasePath,
    artifactsDir,
    store: new V2SqliteStore(database),
    close: () => database.close?.(),
    writeArtifact: (name, content) => {
      const target = join(artifactsDir, name);
      writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
      return target;
    },
  };
}
