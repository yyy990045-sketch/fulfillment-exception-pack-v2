import { DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS } from "../../domain/v2/rules/so-demo-001-rules.js";
import { MANUFACTURING_RULE_DEFINITIONS, MANUFACTURING_RULE_VERSIONS } from "../../domain/v2/rules/so-mfg-001-rules.js";

export const manufacturingRuleContributions = {
  definitions: [...MANUFACTURING_RULE_DEFINITIONS, ...DEMO_RULE_DEFINITIONS],
  versions: [...MANUFACTURING_RULE_VERSIONS, ...DEMO_RULE_VERSIONS],
};
