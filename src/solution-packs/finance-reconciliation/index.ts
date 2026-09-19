import type { V2SqliteStore } from "../../domain/v2/index.js";
import { installSolutionPack } from "../core/installer.js";
import { bindPackContext } from "../core/bindings.js";
import type { SolutionPack } from "../core/types.js";
import { provisionFinanceReconciliationDemo } from "./demo.js";
import { financeEligibility } from "./eligibility.js";
import { FINANCE_RECONCILIATION_MANIFEST } from "./manifest.js";
import { financeOutcomeDefinitions } from "./outcomes.js";
import { financePresentation } from "./presentation.js";
import { financeRuleContributions } from "./rules.js";

export const financeReconciliationPack: SolutionPack = {
  manifest: FINANCE_RECONCILIATION_MANIFEST,
  supportedActionTypes: ["supplement_evidence", "urge_follow_up", "review_quotation", "create_task"],
  ruleContributions: financeRuleContributions,
  outcomeDefinitions: financeOutcomeDefinitions,
  presentation: financePresentation,
  decisionEligibilityResolver: financeEligibility,
  install(store: V2SqliteStore, tenantId: string, actor: string, config = {}) {
    installSolutionPack(store, financeReconciliationPack, tenantId, actor, config);
  },
  provisionDemo(store: V2SqliteStore, tenantId: string) {
    const result = provisionFinanceReconciliationDemo(store, tenantId);
    if (store.getSolutionPackInstallation(tenantId, financeReconciliationPack.manifest.id)?.status === "active") {
      bindPackContext(store, financeReconciliationPack, tenantId, result.contextId, "demo-system");
    }
    return result;
  },
};

export * from "./manifest.js";
export * from "./presentation.js";
export * from "./eligibility.js";
export * from "./outcomes.js";
