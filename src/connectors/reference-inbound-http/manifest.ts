import type { ConnectorManifest } from "../core/types.js";

export const REFERENCE_INBOUND_HTTP_MANIFEST: ConnectorManifest = {
  id: "reference-inbound-http",
  version: "1.0.0",
  name: "Reference Inbound HTTP",
  description: "Local reference read-only HTTP connector for inbound runtime verification.",
  direction: "inbound",
  capabilities: ["read_records"],
  audience: "internal_operations",
  effects: {
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
  },
  compatibility: { coreApiVersion: "1" },
};
