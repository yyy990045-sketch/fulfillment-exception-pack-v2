import type { V2SqliteStore } from "../../domain/v2/index.js";
import { installSolutionPack } from "../core/installer.js";
import type { SolutionPack } from "../core/types.js";
import { provisionManufacturingPackDemo } from "./demo.js";
import { manufacturingEligibility } from "./eligibility.js";
import { MANUFACTURING_FULFILLMENT_MANIFEST } from "./manifest.js";
import { manufacturingOutcomeDefinitions } from "./outcomes.js";
import { manufacturingPresentation } from "./presentation.js";
import { manufacturingRuleContributions } from "./rules.js";

export const manufacturingFulfillmentPack: SolutionPack = {
  manifest: MANUFACTURING_FULFILLMENT_MANIFEST,
  ruleContributions: manufacturingRuleContributions,
  outcomeDefinitions: manufacturingOutcomeDefinitions,
  presentation: manufacturingPresentation,
  decisionEligibilityResolver: manufacturingEligibility,
  install(store: V2SqliteStore, tenantId: string, actor: string) {
    installSolutionPack(store, manufacturingFulfillmentPack, tenantId, actor);
  },
  provisionDemo(store: V2SqliteStore) {
    return provisionManufacturingPackDemo(store);
  },
};

export * from "./manifest.js";
export * from "./presentation.js";
export * from "./eligibility.js";
export * from "./outcomes.js";
