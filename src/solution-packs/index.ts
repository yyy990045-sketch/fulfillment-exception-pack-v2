import { solutionPackRegistry } from "./core/registry.js";
import { manufacturingFulfillmentPack } from "./manufacturing-fulfillment/index.js";

let builtInsRegistered = false;

export function registerBuiltInSolutionPacks() {
  if (builtInsRegistered) return solutionPackRegistry;
  solutionPackRegistry.register(manufacturingFulfillmentPack);
  builtInsRegistered = true;
  return solutionPackRegistry;
}

export * from "./core/index.js";
export * from "./manufacturing-fulfillment/index.js";
