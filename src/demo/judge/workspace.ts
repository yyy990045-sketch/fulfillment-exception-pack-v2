/**
 * Judge Demo 工作区。
 *
 * 两条硬纪律：
 *   1. 每次运行从一个**全新空库**开始，评委 demo 的 "0 异常 / 1 异常" 不会被历史数据污染；
 *   2. reset 只能删这个专属目录，并且要显式检查路径 —— 绝不碰默认库、生产库或用户自定义库。
 */
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { V2SqliteStore, type SqliteDatabaseLike } from "../../domain/v2/index.js";
import { DEFAULT_JUDGE_WORKSPACE_DIR, UNS_STREAM_ARTIFACT_NAME } from "../../traceability/index.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };

export const JUDGE_WORKSPACE_DIR = DEFAULT_JUDGE_WORKSPACE_DIR;
export const JUDGE_EVIDENCE_MANIFEST = "evidence.json";
export const JUDGE_READBACK_ARTIFACT = "execution-readback.json";
export const JUDGE_CONTRACT_ARTIFACT = "judge-contract.json";

export type JudgeWorkspace = {
  rootDir: string;
  databasePath: string;
  store: V2SqliteStore;
  unsStreamPath: string;
  evidenceManifestPath: string;
  readbackPath: string;
  contractPath: string;
  writeArtifact: (name: string, content: string) => string;
  close: () => void;
};

function escapes(parent: string, child: string) {
  const rel = relative(parent, child);
  return !rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..") || rel.split("/").includes("..");
}

/**
 * 路径安全闸门。任何一条不满足就拒绝删除：
 *   - 必须能解析成绝对路径
 *   - 必须位于 <baseDir>/.preview/ 之内，且不等于 .preview 本身
 *   - 不能是仓库根、HOME、文件系统根
 *   - 不能是 .sqlite 文件路径（数据库只通过自己的备份/恢复流程管理）
 *   - 不能是逃出 .preview 的符号链接
 */
export function assertSafeJudgeWorkspace(target: string, baseDir = process.cwd()) {
  const absolute = resolve(target);
  const previewRoot = resolve(baseDir, ".preview");
  const repoRoot = resolve(baseDir);
  const home = process.env.HOME ? resolve(process.env.HOME) : null;
  const forbidden = new Set([repoRoot, previewRoot, "/", home].filter((item): item is string => Boolean(item)));
  if (forbidden.has(absolute)) throw new Error(`JUDGE_WORKSPACE_RESET_FORBIDDEN:${absolute}`);
  if (/\.sqlite(-wal|-shm)?$/.test(absolute)) {
    throw new Error(`JUDGE_WORKSPACE_RESET_FORBIDDEN_DATABASE_FILE:${absolute}`);
  }
  if (escapes(previewRoot, absolute)) throw new Error(`JUDGE_WORKSPACE_OUTSIDE_PREVIEW_ROOT:${absolute}`);
  if (existsSync(absolute)) {
    const real = realpathSync(absolute);
    const realPreviewRoot = existsSync(previewRoot) ? realpathSync(previewRoot) : previewRoot;
    if (escapes(realPreviewRoot, real)) throw new Error(`JUDGE_WORKSPACE_SYMLINK_ESCAPE:${real}`);
  }
  return absolute;
}

/** 只删除 judge 专属工作区；无论成功失败都不会触碰 .preview 之外的任何路径。 */
export function resetJudgeWorkspace(target = JUDGE_WORKSPACE_DIR, baseDir = process.cwd()) {
  const absolute = assertSafeJudgeWorkspace(target, baseDir);
  if (existsSync(absolute)) rmSync(absolute, { recursive: true, force: true });
  return { removed: true, rootDir: absolute };
}

export function openJudgeWorkspace(target = JUDGE_WORKSPACE_DIR, baseDir = process.cwd()): JudgeWorkspace {
  const absolute = assertSafeJudgeWorkspace(target, baseDir);
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("JUDGE_DEMO_REQUIRES_NODE_22_5_OR_NEWER");
  if (existsSync(absolute)) rmSync(absolute, { recursive: true, force: true });
  mkdirSync(absolute, { recursive: true });
  const databasePath = join(absolute, "pack-cases.sqlite");
  const database = new builtin.DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return {
    rootDir: absolute,
    databasePath,
    store: new V2SqliteStore(database),
    unsStreamPath: join(absolute, UNS_STREAM_ARTIFACT_NAME),
    evidenceManifestPath: join(absolute, JUDGE_EVIDENCE_MANIFEST),
    readbackPath: join(absolute, JUDGE_READBACK_ARTIFACT),
    contractPath: join(absolute, JUDGE_CONTRACT_ARTIFACT),
    close: () => database.close?.(),
    writeArtifact: (name, content) => {
      const path = join(absolute, name);
      mkdirSync(absolute, { recursive: true });
      writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
      return path;
    },
  };
}

/** 只读打开（不清理）已有工作区，供 `evidence:verify` 复核已落库的仿真运行。 */
export function openExistingJudgeStore(databasePath: string) {
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("JUDGE_DEMO_REQUIRES_NODE_22_5_OR_NEWER");
  const absolute = resolve(databasePath);
  if (!existsSync(absolute)) throw new Error(`JUDGE_WORKSPACE_DATABASE_NOT_FOUND:${absolute}`);
  const database = new builtin.DatabaseSync(absolute);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return { databasePath: absolute, store: new V2SqliteStore(database), close: () => database.close?.() };
}
