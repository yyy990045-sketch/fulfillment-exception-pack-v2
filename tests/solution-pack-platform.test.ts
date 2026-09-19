import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_SOLUTION_PACK_API_VERSION,
  installSolutionPack,
  registerBuiltInSolutionPacks,
  solutionPackManifestHash,
  solutionPackRegistry,
  manufacturingFulfillmentPack,
  buildPackWorkbenchView,
} from "../src/solution-packs/index.js";
import { directionStatus } from "../src/outcomes/measurement.js";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
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

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-pack-platform-"));
  const db = new sqlite!.DatabaseSync(join(dir, "pack-platform.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Solution Pack Platform", () => {
  it("registers built-in packs and preserves manifest/version compatibility", () => {
    registerBuiltInSolutionPacks();
    expect(solutionPackRegistry.get("manufacturing-fulfillment")?.manifest.version).toBe("1.0.0");
    expect(manufacturingFulfillmentPack.manifest.compatibility.coreApiVersion).toBe(CORE_SOLUTION_PACK_API_VERSION);
    expect(solutionPackManifestHash(manufacturingFulfillmentPack.manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(solutionPackRegistry.resolveByContextType("sales_order")?.manifest.id).toBe("manufacturing-fulfillment");
  });

  it("fails closed on duplicate rule codes across packs", () => {
    registerBuiltInSolutionPacks();
    const conflict = {
      ...manufacturingFulfillmentPack,
      manifest: { ...manufacturingFulfillmentPack.manifest, id: "duplicate-rule-pack", contextTypes: ["project"] },
    };
    expect(() => solutionPackRegistry.register(conflict as typeof manufacturingFulfillmentPack)).toThrow(/PACK_RULE_CODE_CONFLICT/);
  });

  it("installs idempotently with tenant isolation and does not evaluate rules", () => {
    const store = openStore();
    installSolutionPack(store, manufacturingFulfillmentPack, "tenant-a", "admin");
    const first = store.getSolutionPackInstallation("tenant-a", "manufacturing-fulfillment")!;
    installSolutionPack(store, manufacturingFulfillmentPack, "tenant-a", "admin");
    const second = store.getSolutionPackInstallation("tenant-a", "manufacturing-fulfillment")!;
    expect(second.installedAt).toBe(first.installedAt);
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(store.listExceptions("tenant-a", "ctx-so-mfg-001")).toHaveLength(0);
    expect(store.getSolutionPackInstallation("tenant-b", "manufacturing-fulfillment")).toBeUndefined();
  });

  it("preserves the manufacturing Hero identity and pack-owned outcome definitions", () => {
    const store = openStore();
    const provisioned = provisionV2ManufacturingDemoData(store);
    const evaluated = evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001")!;
    expect(provisioned).toMatchObject({ entities: 8, events: 11, evidence: 11 });
    expect(evaluated.evaluations).toHaveLength(7);
    expect(evaluated.evaluations.filter((item) => item.status === "matched")).toHaveLength(4);
    expect(evaluated.evaluations.filter((item) => item.status === "not_matched")).toHaveLength(3);
    expect(evaluated.exceptions).toHaveLength(4);
    expect(store.listOutcomeDefinitions("demo-manufacturing").length).toBeGreaterThanOrEqual(3);
    expect(store.getSolutionPackInstallation("demo-manufacturing", "manufacturing-fulfillment")?.status).toBe("active");
  });

  it("builds a generic pack workbench view without side effects", () => {
    const store = openStore();
    provisionV2ManufacturingDemoData(store);
    evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
    const before = store.listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001").length;
    const view = buildPackWorkbenchView(store, "demo-manufacturing", "ctx-so-mfg-001")!;
    expect(view.pack.id).toBe("manufacturing-fulfillment");
    expect(view.thread.length).toBeGreaterThan(0);
    expect(store.listRuleEvaluations("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before);
  });

  it("hardens non-numeric outcome comparison against implicit improvement", () => {
    expect(directionStatus("open", "open", "toward_target", "closed")).toBe("unchanged");
    expect(directionStatus("open", "pending", "toward_target", "closed")).toBe("insufficient_evidence");
  });
});
