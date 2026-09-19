import { solutionPackRegistry } from "./core/registry.js";
import { manufacturingFulfillmentPack } from "./manufacturing-fulfillment/index.js";
import { financeReconciliationPack } from "./finance-reconciliation/index.js";

let builtInsRegistered = false;

export function registerBuiltInSolutionPacks() {
  if (builtInsRegistered) return solutionPackRegistry;
  solutionPackRegistry.register(manufacturingFulfillmentPack);
  solutionPackRegistry.register(financeReconciliationPack);
  builtInsRegistered = true;
  return solutionPackRegistry;
}

export * from "./core/index.js";
export * from "./manufacturing-fulfillment/index.js";
export * from "./finance-reconciliation/index.js";
