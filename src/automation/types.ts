import type { ActionType } from "../types.js";
import type {
  AutomationRunRecord,
  AutomationReceiptRecord,
  AutomationTriggerSource,
  InternalWorkItemRecord,
} from "../domain/v2/automation-types.js";
import type { PolicyEvaluationView } from "../policy/index.js";

export type AutomationReadiness = {
  executable: boolean;
  policyMode: PolicyEvaluationView["decision"]["mode"];
  policyEvaluationStale: boolean;
  executorConfigured: boolean;
  executorSupportsAction: boolean;
  safetyBoundaryPassed: boolean;
  reasons: string[];
};

export type { AutomationTriggerSource };

export type AutomationEffect = {
  kind: InternalWorkItemRecord["kind"];
  title: string;
  description: string;
  metadata: Record<string, unknown>;
};

export type AutomationExecutionInput = {
  tenantId: string;
  contextId: string;
  exceptionId: string;
  exceptionTitle: string;
  policyEvaluation: PolicyEvaluationView;
  actionType: ActionType;
};

export interface AutomationExecutor {
  name: string;
  version: string;
  supports(actionType: ActionType): boolean;
  execute(input: AutomationExecutionInput): AutomationEffect;
}

export type AutomationRunView = {
  run: AutomationRunRecord;
  receipt?: AutomationReceiptRecord;
  workItem?: InternalWorkItemRecord;
};

export class AutomationError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
    this.name = "AutomationError";
  }
}
