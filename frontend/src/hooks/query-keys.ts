export const queryKeys = {
  accountContext: (tenantId: string, actorId: string) => ["account-context", tenantId, actorId] as const,
  workbench: (tenantId: string, contextId: string) => ["workbench", tenantId, contextId] as const,
  exceptionEvidence: (tenantId: string, contextId: string, exceptionId: string) =>
    ["exception-evidence", tenantId, contextId, exceptionId] as const,
  explanationList: (tenantId: string, contextId: string, exceptionId: string) =>
    ["grounded-explanations", tenantId, contextId, exceptionId] as const,
  explanation: (tenantId: string, contextId: string, exceptionId: string, explanationId: string) =>
    ["grounded-explanation", tenantId, contextId, exceptionId, explanationId] as const,
  rootCauseList: (tenantId: string, contextId: string, exceptionId: string) =>
    ["root-cause-analyses", tenantId, contextId, exceptionId] as const,
  rootCause: (tenantId: string, contextId: string, exceptionId: string, analysisId: string) =>
    ["root-cause-analysis", tenantId, contextId, exceptionId, analysisId] as const,
  decisionList: (tenantId: string, contextId: string, exceptionId: string) =>
    ["decision-recommendations", tenantId, contextId, exceptionId] as const,
  decision: (tenantId: string, contextId: string, exceptionId: string, recommendationId: string) =>
    ["decision-recommendation", tenantId, contextId, exceptionId, recommendationId] as const,
  policyEvaluations: (tenantId: string, contextId: string, exceptionId: string) =>
    ["policy-evaluations", tenantId, contextId, exceptionId] as const,
  resolutionList: (tenantId: string, contextId: string) =>
    ["resolution-cases", tenantId, contextId] as const,
  resolutionCase: (tenantId: string, caseId: string) =>
    ["resolution-case", tenantId, caseId] as const,
  resolutionCapabilities: (tenantId: string, actorId: string, contextId: string, exceptionId: string) =>
    ["resolution-capabilities", tenantId, actorId, contextId, exceptionId] as const,
  outcomeEvaluations: (tenantId: string, contextId: string, exceptionId: string) =>
    ["outcome-evaluations", tenantId, contextId, exceptionId] as const,
};
