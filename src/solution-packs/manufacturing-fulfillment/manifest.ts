import type { SolutionPackManifest } from "../core/types.js";

export const MANUFACTURING_FULFILLMENT_MANIFEST: SolutionPackManifest = {
  id: "manufacturing-fulfillment",
  version: "1.0.0",
  name: "Manufacturing Fulfillment",
  description: "Manufacturing order fulfillment exception and governance solution pack.",
  contextTypes: ["sales_order"],
  capabilities: {
    rules: true,
    outcomes: true,
    presentation: true,
    decisionEligibility: true,
    demo: true,
  },
  workbenchPath: "/manufacturing",
  compatibility: { coreApiVersion: "1" },
};
