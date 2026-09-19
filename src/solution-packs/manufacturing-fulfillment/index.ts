import type { V2SqliteStore } from "../../domain/v2/index.js";
import { installSolutionPack } from "../core/installer.js";
import { bindPackContext } from "../core/bindings.js";
import type { SolutionPack } from "../core/types.js";
import { provisionManufacturingPackDemo } from "./demo.js";
import { manufacturingEligibility } from "./eligibility.js";
import { MANUFACTURING_FULFILLMENT_MANIFEST } from "./manifest.js";
import { manufacturingOutcomeDefinitions } from "./outcomes.js";
import { manufacturingPresentation } from "./presentation.js";
import { manufacturingRuleContributions } from "./rules.js";

export const manufacturingFulfillmentPack: SolutionPack = {
  manifest: MANUFACTURING_FULFILLMENT_MANIFEST,
  supportedActionTypes: ["supplement_evidence", "urge_follow_up", "reject_overclaim", "review_quotation", "create_task"],
  ruleContributions: manufacturingRuleContributions,
  outcomeDefinitions: manufacturingOutcomeDefinitions,
  presentation: manufacturingPresentation,
  decisionEligibilityResolver: manufacturingEligibility,
  install(store: V2SqliteStore, tenantId: string, actor: string, config = {}) {
    installSolutionPack(store, manufacturingFulfillmentPack, tenantId, actor, config);
  },
  provisionDemo(store: V2SqliteStore) {
    const result = provisionManufacturingPackDemo(store);
    if (result.contextId && store.getSolutionPackInstallation("demo-manufacturing", manufacturingFulfillmentPack.manifest.id)?.status === "active") {
      bindPackContext(store, manufacturingFulfillmentPack, "demo-manufacturing", result.contextId, "demo-system");
    }
    return result;
  },
};

export * from "./manifest.js";
export * from "./presentation.js";
export * from "./eligibility.js";
export * from "./outcomes.js";
