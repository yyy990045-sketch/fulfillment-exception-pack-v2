import type { V2SqliteStore } from "../../domain/v2/index.js";
import { installSolutionPack } from "../core/installer.js";
import type { SolutionPack } from "../core/types.js";
import { provisionFinanceReconciliationDemo } from "./demo.js";
import { financeEligibility } from "./eligibility.js";
import { FINANCE_RECONCILIATION_MANIFEST } from "./manifest.js";
import { financeOutcomeDefinitions } from "./outcomes.js";
import { financePresentation } from "./presentation.js";
import { financeRuleContributions } from "./rules.js";

export const financeReconciliationPack: SolutionPack = {
  manifest: FINANCE_RECONCILIATION_MANIFEST,
  ruleContributions: financeRuleContributions,
  outcomeDefinitions: financeOutcomeDefinitions,
  presentation: financePresentation,
  decisionEligibilityResolver: financeEligibility,
  install(store: V2SqliteStore, tenantId: string, actor: string) {
    installSolutionPack(store, financeReconciliationPack, tenantId, actor);
  },
  provisionDemo(store: V2SqliteStore) {
    return provisionFinanceReconciliationDemo(store);
  },
};

export * from "./manifest.js";
export * from "./presentation.js";
export * from "./eligibility.js";
export * from "./outcomes.js";
