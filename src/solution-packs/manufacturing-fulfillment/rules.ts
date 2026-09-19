import { DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS } from "../../domain/v2/rules/so-demo-001-rules.js";
import { MANUFACTURING_RULE_DEFINITIONS, MANUFACTURING_RULE_VERSIONS } from "../../domain/v2/rules/so-mfg-001-rules.js";
import type { PackRuleDefinitionTemplate, PackRuleVersionTemplate } from "../core/types.js";

function definitionTemplate(input: (typeof MANUFACTURING_RULE_DEFINITIONS)[number], profile: string): PackRuleDefinitionTemplate {
  const { tenantId: _tenantId, createdAt: _createdAt, ...rest } = input;
  return { ...rest, metadata: { ...rest.metadata, profile } };
}

function versionTemplate(input: (typeof MANUFACTURING_RULE_VERSIONS)[number]): PackRuleVersionTemplate {
  return {
    id: input.id,
    ruleId: input.ruleId,
    version: input.version,
    status: input.status,
    config: input.config,
    contentHash: input.contentHash,
  };
}

export const manufacturingRuleContributions = {
  definitions: [
    ...MANUFACTURING_RULE_DEFINITIONS.map((item) => definitionTemplate(item, "manufacturing")),
    ...DEMO_RULE_DEFINITIONS.map((item) => definitionTemplate(item, "industrial")),
  ],
  versions: [
    ...MANUFACTURING_RULE_VERSIONS.map((item) => versionTemplate(item)),
    ...DEMO_RULE_VERSIONS.map((item) => versionTemplate(item)),
  ],
};
