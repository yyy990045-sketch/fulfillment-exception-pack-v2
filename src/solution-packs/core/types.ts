import type { BusinessEntityType, ExceptionCode, FulfillmentContextType, RuleVersion, V2SqliteStore } from "../../domain/v2/index.js";
import type { ActionType } from "../../types.js";
import type { OutcomeDefinitionInput } from "../../outcomes/index.js";

export const CORE_SOLUTION_PACK_API_VERSION = "1";

export type SolutionPackCapabilities = {
  rules: boolean;
  outcomes: boolean;
  presentation: boolean;
  decisionEligibility: boolean;
  demo: boolean;
};

export type SolutionPackManifest = {
  id: string;
  version: string;
  name: string;
  description: string;
  contextTypes: FulfillmentContextType[];
  capabilities: SolutionPackCapabilities;
  workbenchPath?: string;
  compatibility: { coreApiVersion: string };
};

export type PackPresentation = {
  contextLabel: string;
  entityLabels: Record<string, string>;
  exceptionLabels: Record<string, string>;
  ruleLabels: Record<string, string>;
  stages: Array<{
    key: string;
    label: string;
    entityType: BusinessEntityType;
    factSelectors: Array<{ key: string; field: string; label?: string }>;
  }>;
};

export type PackDecisionEligibilityContribution = {
  actionType: ActionType;
  eligible: boolean;
  reason: string;
};

export type PackRuleDefinitionTemplate = {
  id: string;
  code: string;
  name: string;
  description: string;
  exceptionType: ExceptionCode;
  enabled: boolean;
  metadata: Record<string, unknown>;
};

export type PackRuleVersionTemplate = {
  id: string;
  ruleId: string;
  version: string;
  status: RuleVersion["status"];
  config: RuleVersion["config"];
  contentHash: string;
};

export interface SolutionPack {
  manifest: SolutionPackManifest;
  ruleContributions: {
    definitions: PackRuleDefinitionTemplate[];
    versions: PackRuleVersionTemplate[];
  };
  outcomeDefinitions: OutcomeDefinitionInput[];
  presentation: PackPresentation;
  decisionEligibilityResolver?: (exceptionCode: string) => PackDecisionEligibilityContribution[] | undefined;
  install(store: V2SqliteStore, tenantId: string, actor: string, config?: Record<string, unknown>): void;
  provisionDemo?(store: V2SqliteStore, tenantId: string, actor: string): unknown;
}

export class SolutionPackError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
    this.name = "SolutionPackError";
  }
}
