import type { components } from "../../api/schema.js";

export type OperationalAnalyticsView = components["schemas"]["OperationalAnalyticsResponse"];
export type OperationalContextView = OperationalAnalyticsView["contexts"][number];
export type SolutionPackInstalledListView = components["schemas"]["SolutionPackInstalledList"];
export type InstalledSolutionPackView = SolutionPackInstalledListView["installations"][number];
export type PackBoundContextView = InstalledSolutionPackView["boundContexts"][number];
export type PackSupportedActionView = InstalledSolutionPackView["supportedActions"][number];
export type SolutionPackCatalogView = components["schemas"]["SolutionPackCatalog"];
export type SolutionPackManifestView = components["schemas"]["SolutionPackManifest"];
export type InternalWorkItemListView = components["schemas"]["InternalWorkItemList"];

export type PackWorkbenchView = {
  pack: {
    id: string;
    version: string;
    name: string;
    contextLabel: string;
    workbenchPath: string;
    supportedActions: Array<{ type: string; label: string }>;
  };
  context: {
    id: string;
    tenantId: string;
    businessKey: string;
    contextType: string;
    status: string;
    openedAt: string;
    updatedAt: string;
  };
  stats: {
    entities: number;
    evidence: number;
    ruleEvaluations: number;
    matchedRules: number;
    notMatchedRules: number;
    exceptions: number;
  };
  thread: Array<{
    key: string;
    label: string;
    entityId: string;
    businessKey: string;
    facts: Array<{
      key: string;
      label: string;
      field: string;
      value: unknown;
      valueType: string;
      evidenceId: string;
    }>;
    state: "normal" | "exception";
  }>;
  rules: Array<{
    id: string;
    code: string;
    label: string;
    status: string;
    matched: boolean;
    metrics: Record<string, unknown>;
  }>;
  exceptions: Array<{
    id: string;
    code: string;
    label: string;
    title: string;
    summary: string;
    severity: string;
    metrics: Record<string, unknown>;
    evidenceCount: number;
  }>;
  outcomes: components["schemas"]["OutcomeEvaluation"][];
  truthfulness: {
    syntheticDemoData: boolean;
    packBound: boolean;
    causalAttribution: false;
  };
};
