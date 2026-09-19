import type { ConnectorManifest } from "../core/types.js";

export const REFERENCE_INTERNAL_TASK_HTTP_MANIFEST: ConnectorManifest = {
  id: "reference-internal-task-http",
  version: "1.0.0",
  name: "Reference Internal Task HTTP",
  description: "Local reference HTTP connector for reliable internal task delivery.",
  direction: "outbound",
  capabilities: ["deliver_internal_task", "deliver_evidence_request"],
  audience: "internal_operations",
  effects: {
    customerFacing: false,
    financialMovement: false,
    legalEffect: false,
  },
  compatibility: { coreApiVersion: "1" },
};
