import type { AutomationExecutor } from "./types.js";

export function executorSupports(executor: AutomationExecutor, actionType: Parameters<AutomationExecutor["supports"]>[0]) {
  return executor.supports(actionType);
}
