import { InternalAutomationExecutor } from "./internal-executor.js";
import { AutomationError, type AutomationExecutor } from "./types.js";

export type AutomationRuntimeConfig = {
  enabled: boolean;
  executorConfigured: boolean;
  executorName?: string;
};

export function automationRuntimeConfig(env: Record<string, string | undefined> = process.env): AutomationRuntimeConfig {
  const enabled = env.AUTOMATION_ENABLED === "true";
  const executorName = env.AUTOMATION_EXECUTOR?.trim();
  return {
    enabled,
    executorConfigured: executorName === "internal",
    ...(executorName ? { executorName } : {}),
  };
}

export function resolveAutomationExecutor(
  options: { env?: Record<string, string | undefined>; executor?: AutomationExecutor } = {},
): AutomationExecutor {
  const env = options.env ?? process.env;
  const config = automationRuntimeConfig(env);
  if (!config.enabled) throw new AutomationError("AUTOMATION_DISABLED", 503);
  if (!config.executorConfigured) throw new AutomationError("AUTOMATION_EXECUTOR_NOT_CONFIGURED", 503);
  if (options.executor) {
    if (options.executor.name !== "internal" || options.executor.version !== "internal-work-item-v1") {
      throw new AutomationError("AUTOMATION_EXECUTOR_NOT_CONFIGURED", 503);
    }
    return options.executor;
  }
  return new InternalAutomationExecutor();
}
