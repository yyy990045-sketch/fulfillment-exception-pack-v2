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

export type SolutionPackContextBindingRecord = {
  tenantId: string;
  packId: string;
  packVersion: string;
  contextId: string;
  boundAt: string;
  boundBy: string;
  source: "pack_provision" | "migration_backfill" | "manual";
};
