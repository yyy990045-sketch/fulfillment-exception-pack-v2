export type SolutionPackInstallationStatus = "active" | "inactive";

export type SolutionPackInstallationRecord = {
  tenantId: string;
  packId: string;
  packVersion: string;
  status: SolutionPackInstallationStatus;
  manifestHash: string;
  config: Record<string, unknown>;
  installedBy: string;
  installedAt: string;
  updatedAt: string;
};
