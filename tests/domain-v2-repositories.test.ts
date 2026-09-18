import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  V2SqliteStore,
  createV2Repositories,
  seedSoDemo001,
} from "../src/domain/v2/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("V2 repository boundary", () => {
  it("exposes domain repositories without SQL in callers", () => {
    const dir = mkdtempSync(join(tmpdir(), "fep-v2-repositories-"));
    const db = new sqlite!.DatabaseSync(join(dir, "repositories.sqlite"));
    databases.push(db);
    const repositories = createV2Repositories(new V2SqliteStore(db));
    seedSoDemo001(new V2SqliteStore(db));

    expect(repositories.contexts.get("demo-industrial", "ctx-so-demo-001")?.businessKey).toBe("SO-DEMO-001");
    expect(repositories.entities.list("demo-industrial", "ctx-so-demo-001")).toHaveLength(6);
    expect(repositories.sourceSystems.listInvolved("demo-industrial", "ctx-so-demo-001")).toHaveLength(5);
    expect(repositories.sourceDocuments.list("demo-industrial", "ctx-so-demo-001")).toHaveLength(6);
    expect(repositories.events.list("demo-industrial", "ctx-so-demo-001")).toHaveLength(6);
  });
});
