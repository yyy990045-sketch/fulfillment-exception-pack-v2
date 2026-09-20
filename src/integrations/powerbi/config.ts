import type { PowerBiConfig } from "./types.js";

const REQUIRED_ENV_KEYS = [
  "POWERBI_TENANT_ID",
  "POWERBI_PRODUCT_TENANT_ID",
  "POWERBI_CLIENT_ID",
  "POWERBI_CLIENT_SECRET",
  "POWERBI_WORKSPACE_ID",
  "POWERBI_REPORT_ID",
] as const;

function readRequired(env: NodeJS.ProcessEnv, key: typeof REQUIRED_ENV_KEYS[number]) {
  const value = env[key]?.trim();
  return value || undefined;
}

export function loadPowerBiConfig(env: NodeJS.ProcessEnv = process.env): PowerBiConfig | null {
  const values = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, readRequired(env, key)]),
  ) as Record<(typeof REQUIRED_ENV_KEYS)[number], string | undefined>;
  if (REQUIRED_ENV_KEYS.some((key) => !values[key])) return null;

  return {
    entraTenantId: values.POWERBI_TENANT_ID!,
    productTenantId: values.POWERBI_PRODUCT_TENANT_ID!,
    clientId: values.POWERBI_CLIENT_ID!,
    clientSecret: values.POWERBI_CLIENT_SECRET!,
    workspaceId: values.POWERBI_WORKSPACE_ID!,
    reportId: values.POWERBI_REPORT_ID!,
    ...(env.POWERBI_DATASET_ID?.trim() ? { datasetId: env.POWERBI_DATASET_ID.trim() } : {}),
    authorityHost: (env.POWERBI_AUTHORITY_HOST?.trim() || "https://login.microsoftonline.com").replace(/\/+$/, ""),
  };
}

export function isPowerBiConfigured(env: NodeJS.ProcessEnv = process.env) {
  return loadPowerBiConfig(env) !== null;
}
