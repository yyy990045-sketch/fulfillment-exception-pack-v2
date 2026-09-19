import type { SolutionPackManifest } from "../core/types.js";

export const FINANCE_RECONCILIATION_MANIFEST: SolutionPackManifest = {
  id: "finance-reconciliation",
  version: "1.0.0",
  name: "Finance Reconciliation",
  description: "Synthetic accounts receivable, invoice, and bank payment reconciliation proof pack.",
  contextTypes: ["finance_reconciliation"],
  capabilities: {
    rules: true,
    outcomes: true,
    presentation: true,
    decisionEligibility: true,
    demo: true,
  },
  workbenchPath: "/workspace?context=ctx-fin-rec-001&tenant=demo-finance",
  compatibility: { coreApiVersion: "1" },
};
