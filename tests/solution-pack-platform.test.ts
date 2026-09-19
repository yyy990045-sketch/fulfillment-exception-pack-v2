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
  financeReconciliationPack,
  buildPackWorkbenchView,
  presentBoundContexts,
  presentSupportedActions,
  resolveInstalledPackForContext,
  bindPackContext,
} from "../src/solution-packs/index.js";
import { directionStatus } from "../src/outcomes/measurement.js";
import { buildDemoWorkspaceProjection } from "../src/application/demo-workspaces.js";
import {
  V2SqliteStore,
  createFulfillmentContext,
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

  it("materializes Finance rules for an arbitrary tenant without pack source changes", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    installSolutionPack(store, financeReconciliationPack, "tenant-customer-a", "admin", { ruleProfile: "finance" });
    financeReconciliationPack.provisionDemo?.(store, "tenant-customer-a", "admin");
    const evaluated = evaluateContextRules(store, "tenant-customer-a", "ctx-fin-rec-001")!;
    expect(evaluated.evaluations).toHaveLength(3);
    expect(evaluated.evaluations.filter((item) => item.status === "matched")).toHaveLength(2);
    expect(evaluated.evaluations.filter((item) => item.status === "not_matched")).toHaveLength(1);
    expect(evaluated.exceptions).toHaveLength(2);
  });

  it("binds Pack Contexts from rule contributions and exposes backend-owned action labels", () => {
    const store = openStore();
    provisionV2ManufacturingDemoData(store);
    financeReconciliationPack.install(store, "demo-finance", "admin", { ruleProfile: "finance" });
    financeReconciliationPack.provisionDemo?.(store, "demo-finance", "admin");
    evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
    evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001");

    expect(presentBoundContexts(store, "demo-manufacturing", "manufacturing-fulfillment").map((item) => item.contextId))
      .toEqual(["ctx-so-mfg-001"]);
    expect(presentBoundContexts(store, "demo-finance", "finance-reconciliation").map((item) => item.contextId))
      .toEqual(["ctx-fin-rec-001"]);
    expect(presentBoundContexts(store, "demo-manufacturing", "finance-reconciliation")).toEqual([]);
    expect(presentSupportedActions(manufacturingFulfillmentPack)).toEqual(expect.arrayContaining([
      { type: "supplement_evidence", label: "补充证据" },
      { type: "reject_overclaim", label: "驳回超额主张" },
    ]));
  });

  it("projects demo organizations, installed packs, bound contexts, and safe default routes", () => {
    const store = openStore();
    provisionV2ManufacturingDemoData(store);
    financeReconciliationPack.install(store, "demo-finance", "admin", { ruleProfile: "finance" });
    financeReconciliationPack.provisionDemo?.(store, "demo-finance", "admin");
    evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
    evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001");

    const demo = buildDemoWorkspaceProjection(store);
    const manufacturing = demo.organizations.find((item) => item.tenantId === "demo-manufacturing")!;
    const finance = demo.organizations.find((item) => item.tenantId === "demo-finance")!;
    expect(manufacturing.organization).toBe("示例制造企业");
    expect(manufacturing.defaultPath).toBe("/manufacturing/ctx-so-mfg-001");
    expect(manufacturing.packs.find((item) => item.packId === "manufacturing-fulfillment")?.contexts.map((item) => item.contextId))
      .toEqual(["ctx-so-mfg-001"]);
    expect(finance.organization).toBe("示例财务企业");
    expect(finance.defaultPath).toBe("/workspace/ctx-fin-rec-001");
    expect(finance.packs.find((item) => item.packId === "finance-reconciliation")?.contexts.map((item) => item.contextId))
      .toEqual(["ctx-fin-rec-001"]);
  });

  it("keeps explicit bound contexts visible before any RuleEvaluation exists", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    financeReconciliationPack.install(store, "demo-finance", "admin", { ruleProfile: "finance" });
    financeReconciliationPack.provisionDemo?.(store, "demo-finance", "admin");
    expect(store.listRuleEvaluations("demo-finance", "ctx-fin-rec-001")).toEqual([]);
    expect(presentBoundContexts(store, "demo-finance", "finance-reconciliation").map((item) => item.contextId))
      .toEqual(["ctx-fin-rec-001"]);
  });

  it("fails closed when explicit binding conflicts with another Pack's RuleEvaluation contribution", () => {
    registerBuiltInSolutionPacks();
    const store = {
      getSolutionPackContextBinding: () => ({
        tenantId: "tenant-a",
        packId: "manufacturing-fulfillment",
        packVersion: "1.0.0",
        contextId: "ctx-a",
        boundAt: "2026-09-01T00:00:00.000Z",
        boundBy: "tester",
        source: "manual" as const,
      }),
      getContext: () => ({ id: "ctx-a", tenantId: "tenant-a", contextType: "sales_order" }),
      getSolutionPackInstallation: () => ({ status: "active", packVersion: "1.0.0" }),
      listRuleEvaluations: () => [{ ruleId: "finance-rule-invoice-receivable-amount" }],
    };
    expect(() => resolveInstalledPackForContext(store as never, {
      id: "ctx-a",
      tenantId: "tenant-a",
      businessKey: "CTX-A",
      contextType: "sales_order",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    })).toThrow(/PACK_CONTEXT_BINDING_EVALUATION_CONFLICT/);
  });

  it("rejects cross-tenant explicit binding", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    financeReconciliationPack.install(store, "tenant-a", "admin", { ruleProfile: "finance" });
    financeReconciliationPack.install(store, "tenant-b", "admin", { ruleProfile: "finance" });
    store.saveContext(createFulfillmentContext({
      id: "ctx-shared",
      tenantId: "tenant-a",
      businessKey: "CTX-A",
      contextType: "finance_reconciliation",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    }));
    expect(() => bindPackContext(store, financeReconciliationPack, "tenant-b", "ctx-shared", "admin"))
      .toThrow(/PACK_CONTEXT_NOT_FOUND/);
  });

  it("disambiguates same-context-type Packs from explicit tenant bindings", () => {
    registerBuiltInSolutionPacks();
    const makePack = (id: string, contextType: string) => ({
      ...manufacturingFulfillmentPack,
      manifest: {
        ...manufacturingFulfillmentPack.manifest,
        id,
        name: id,
        contextTypes: [contextType],
      },
      ruleContributions: {
        definitions: [{
          id: `${id}-rule`,
          code: `${id.toUpperCase()}.RULE`,
          name: id,
          description: id,
          exceptionType: `${id.toUpperCase()}_EXCEPTION`,
          enabled: true,
          metadata: { packId: id },
        }],
        versions: [],
      },
      outcomeDefinitions: [],
      supportedActionTypes: [],
    });
    const packA = makePack("shared-binding-a", "shared_test_context");
    const packB = makePack("shared-binding-b", "shared_test_context");
    solutionPackRegistry.register(packA as typeof manufacturingFulfillmentPack);
    solutionPackRegistry.register(packB as typeof manufacturingFulfillmentPack);
    const evaluations: Record<string, Array<{ ruleId: string }>> = {
      "ctx-a": [{ ruleId: "shared-binding-a-rule" }],
      "ctx-b": [{ ruleId: "shared-binding-b-rule" }],
    };
    const bindings: Record<string, { tenantId: string; packId: string; packVersion: string; contextId: string; boundAt: string; boundBy: string; source: "manual" }> = {
      "ctx-a": { tenantId: "tenant-a", packId: "shared-binding-a", packVersion: "1.0.0", contextId: "ctx-a", boundAt: "2026-09-01T00:00:00.000Z", boundBy: "tester", source: "manual" },
      "ctx-b": { tenantId: "tenant-a", packId: "shared-binding-b", packVersion: "1.0.0", contextId: "ctx-b", boundAt: "2026-09-01T00:00:00.000Z", boundBy: "tester", source: "manual" },
    };
    const store = {
      listRuleEvaluations: (_tenantId: string, contextId: string) => evaluations[contextId] ?? [],
      getSolutionPackInstallation: () => ({ status: "active", packVersion: "1.0.0" }),
      getSolutionPackContextBinding: (_tenantId: string, contextId: string) => bindings[contextId],
      getContext: (_tenantId: string, contextId: string) => ({ id: contextId, tenantId: "tenant-a", contextType: "shared_test_context" }),
    };

    expect(resolveInstalledPackForContext(store as never, {
      id: "ctx-a",
      tenantId: "tenant-a",
      businessKey: "CTX-A",
      contextType: "shared_test_context",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    })).toMatchObject({ manifest: { id: "shared-binding-a" } });
    expect(resolveInstalledPackForContext(store as never, {
      id: "ctx-b",
      tenantId: "tenant-a",
      businessKey: "CTX-B",
      contextType: "shared_test_context",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    })).toMatchObject({ manifest: { id: "shared-binding-b" } });
  });

  it("materializes Manufacturing rules for a second arbitrary tenant", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    installSolutionPack(store, manufacturingFulfillmentPack, "tenant-customer-b", "admin", { ruleProfile: "manufacturing" });
    expect(store.listEnabledRuleDefinitions("tenant-customer-b").length).toBeGreaterThanOrEqual(7);
  });

  it("default-denies unknown ContextTypes instead of running all installed rules", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    installSolutionPack(store, financeReconciliationPack, "tenant-customer-a", "admin");
    store.saveContext(createFulfillmentContext({
      id: "ctx-unknown-001",
      tenantId: "tenant-customer-a",
      businessKey: "UNKNOWN-001",
      contextType: "some_future_domain",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: {},
    }));
    const evaluated = evaluateContextRules(store, "tenant-customer-a", "ctx-unknown-001")!;
    expect(evaluated.evaluations).toHaveLength(0);
  });

  it("derives synthetic truthfulness from context/evidence rather than hardcoding it", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    installSolutionPack(store, financeReconciliationPack, "tenant-real", "admin");
    store.saveContext(createFulfillmentContext({
      id: "ctx-real-fin-001",
      tenantId: "tenant-real",
      businessKey: "REAL-FIN-001",
      contextType: "finance_reconciliation",
      status: "active",
      openedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      metadata: { synthetic: false },
    }));
    bindPackContext(store, financeReconciliationPack, "tenant-real", "ctx-real-fin-001", "admin");
    expect(buildPackWorkbenchView(store, "tenant-real", "ctx-real-fin-001")?.truthfulness.syntheticDemoData).toBe(false);
  });
});
