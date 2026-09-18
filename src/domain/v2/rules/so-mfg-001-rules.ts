import type { RuleDefinition, RuleVersion } from "../rule-types.js";
import { DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS } from "./so-demo-001-rules.js";

const tenantId = "demo-manufacturing";

export const MANUFACTURING_RULE_DEFINITIONS: RuleDefinition[] = DEMO_RULE_DEFINITIONS.map((definition) => ({
  ...definition,
  tenantId,
  metadata: { ...definition.metadata, fixture: "SO-MFG-001" },
}));

export const MANUFACTURING_RULE_VERSIONS: RuleVersion[] = DEMO_RULE_VERSIONS.map((version) => ({
  ...version,
  tenantId,
}));
