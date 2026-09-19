import { ReferenceInternalTaskHttpConnector } from "./reference-internal-task-http/connector.js";
import { connectorRegistry } from "./core/registry.js";

let builtInsRegistered = false;

export function registerBuiltInConnectors() {
  if (builtInsRegistered) return connectorRegistry;
  connectorRegistry.register(new ReferenceInternalTaskHttpConnector());
  builtInsRegistered = true;
  return connectorRegistry;
}

export * from "./core/index.js";
export * from "./reference-internal-task-http/index.js";
