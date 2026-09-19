import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPackWorkbenchView,
  financeReconciliationPack,
  registerBuiltInSolutionPacks,
  solutionPackRegistry,
} from "../src/solution-packs/index.js";
import {
  V2SqliteStore,
  evaluateContextRules,
} from "../src/domain/v2/index.js";
import {
  DeterministicGroundedAiProvider,
  generateGroundedExplanation,
} from "../src/ai/grounded/index.js";
import {
  DeterministicRootCauseProvider,
  generateRootCauseAnalysis,
} from "../src/ai/root-cause/index.js";
import {
  DeterministicDecisionRecommendationProvider,
  generateDecisionRecommendation,
} from "../src/ai/decision/index.js";
import { evaluateDecisionPolicy } from "../src/policy/index.js";
import { InternalAutomationExecutor, executePolicyAutomation } from "../src/automation/index.js";
import { evaluateOutcome } from "../src/outcomes/index.js";
import { buildOutcomeAnalytics } from "../src/outcomes/analytics.js";
import { DefaultDecisionActionEligibilityResolver } from "../src/ai/decision/eligibility.js";

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
  const dir = mkdtempSync(join(tmpdir(), "fep-finance-pack-"));
  const db = new sqlite!.DatabaseSync(join(dir, "finance.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

function installFinance(store: V2SqliteStore) {
  registerBuiltInSolutionPacks();
  financeReconciliationPack.install(store, "demo-finance", "demo-system");
  financeReconciliationPack.provisionDemo?.(store, "demo-finance", "demo-system");
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Finance Reconciliation Solution Pack", () => {
  it("provisions 3 evaluations, 2 matched, 1 not matched, and 2 exceptions", () => {
    const store = openStore();
    installFinance(store);
    const evaluated = evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001")!;
    expect(evaluated.evaluations).toHaveLength(3);
    expect(evaluated.evaluations.filter((item) => item.status === "matched")).toHaveLength(2);
    expect(evaluated.evaluations.filter((item) => item.status === "not_matched")).toHaveLength(1);
    expect(evaluated.exceptions.map((item) => item.code)).toEqual([
      "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING",
      "FINANCE.INVOICE_PAYMENT_AMOUNT_MISMATCH",
    ]);
    expect(store.getExceptionEvidenceBundle("demo-finance", evaluated.exceptions[0]!.id)?.sourceSystems.map((item) => item.id)).toEqual(expect.arrayContaining(["FIN-ERP-DEMO", "BANK-DEMO"]));
    expect(solutionPackRegistry.resolveByContextType("finance_reconciliation")?.manifest.id).toBe("finance-reconciliation");
  });

  it("keeps manufacturing and finance rule scopes isolated", () => {
    const store = openStore();
    installFinance(store);
    const finance = evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001")!;
    expect(finance.evaluations.every((item) => store.getRuleDefinition("demo-finance", item.ruleId)?.metadata.packId === "finance-reconciliation")).toBe(true);
  });

  it("does not evaluate or expose an uninstalled registered pack", () => {
    const store = openStore();
    registerBuiltInSolutionPacks();
    financeReconciliationPack.provisionDemo?.(store, "demo-finance", "demo-system");
    const evaluated = evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001")!;
    expect(evaluated.evaluations).toHaveLength(0);
    expect(() => buildPackWorkbenchView(store, "demo-finance", "ctx-fin-rec-001")).toThrow(/PACK_NOT_INSTALLED/);
  });

  it("renders the generic three-stage finance workspace", () => {
    const store = openStore();
    installFinance(store);
    evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001");
    const view = buildPackWorkbenchView(store, "demo-finance", "ctx-fin-rec-001")!;
    expect(view.pack.id).toBe("finance-reconciliation");
    expect(view.thread.map((item) => item.label)).toEqual(["应收", "发票", "银行回款"]);
    expect(view.exceptions).toHaveLength(2);
  });

  it("reuses Core AI, Policy, Automation, Outcome, and Analytics end to end", async () => {
    const store = openStore();
    installFinance(store);
    evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001");
    const exception = store.listExceptions("demo-finance", "ctx-fin-rec-001")
      .find((item) => item.code === "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING")!;
    const eligibility = new DefaultDecisionActionEligibilityResolver().resolve(exception);
    expect(eligibility.find((item) => item.actionType === "urge_follow_up")?.eligible).toBe(true);
    const explanation = await generateGroundedExplanation(store, new DeterministicGroundedAiProvider(), "demo-finance", "ctx-fin-rec-001", exception.id, "finance-owner");
    expect(explanation.status).toBe("generated");
    const rootCause = await generateRootCauseAnalysis(store, new DeterministicRootCauseProvider(), "demo-finance", "ctx-fin-rec-001", exception.id, "finance-owner");
    expect(rootCause.status).toBe("generated");
    const recommendation = await generateDecisionRecommendation(store, new DeterministicDecisionRecommendationProvider(), "demo-finance", "ctx-fin-rec-001", exception.id, "finance-owner");
    expect(recommendation.status).toBe("generated");
    const policy = evaluateDecisionPolicy(store, "demo-finance", "ctx-fin-rec-001", exception.id, { actionType: "create_task" }, "finance-owner");
    const automation = executePolicyAutomation(store, "demo-finance", "ctx-fin-rec-001", exception.id, policy.id, "finance-owner", "human_request", {
      env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
      executor: new InternalAutomationExecutor(),
    });
    expect(automation.workItem?.kind).toBe("task");
    const definition = store.listOutcomeDefinitions("demo-finance", exception.code, true)[0]!;
    const outcome = evaluateOutcome(store, "demo-finance", "ctx-fin-rec-001", exception.id, {
      definitionId: definition.id,
      evidenceIds: ["evidence-payment-fin-outstanding"],
      automationRunId: automation.run.id,
    }, "finance-owner");
    expect(outcome.status).toBe("target_met");
    const analytics = buildOutcomeAnalytics(store, "demo-finance");
    expect(analytics.summary.measuredOutcomeCount).toBe(1);
  });
});
