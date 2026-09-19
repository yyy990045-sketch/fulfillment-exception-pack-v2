export const queryKeys = {
  workbench: (tenantId: string, contextId: string) => ["workbench", tenantId, contextId] as const,
  exceptionEvidence: (tenantId: string, contextId: string, exceptionId: string) =>
    ["exception-evidence", tenantId, contextId, exceptionId] as const,
};
