import type { SupersetConfig } from "./types.js";

const REQUIRED_ENV_KEYS = [
  "SUPERSET_DOMAIN",
  "SUPERSET_DASHBOARD_ID",
  "SUPERSET_PRODUCT_TENANT_ID",
  "SUPERSET_SERVICE_USERNAME",
  "SUPERSET_SERVICE_PASSWORD",
] as const;

function readRequired(env: NodeJS.ProcessEnv, key: typeof REQUIRED_ENV_KEYS[number]) {
  const value = env[key]?.trim();
  return value || undefined;
}

/**
 * 读取 Superset 嵌入所需配置。缺任何一项都返回 null（fail closed），
 * 由调用方映射为 503 SUPERSET_NOT_CONFIGURED，而不是猜测或降级。
 */
export function loadSupersetConfig(env: NodeJS.ProcessEnv = process.env): SupersetConfig | null {
  const values = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, readRequired(env, key)]),
  ) as Record<(typeof REQUIRED_ENV_KEYS)[number], string | undefined>;
  if (REQUIRED_ENV_KEYS.some((key) => !values[key])) return null;

  const ttl = Number(env.SUPERSET_GUEST_TOKEN_TTL ?? "300");
  return {
    domain: values.SUPERSET_DOMAIN!.replace(/\/+$/, ""),
    dashboardId: values.SUPERSET_DASHBOARD_ID!,
    productTenantId: values.SUPERSET_PRODUCT_TENANT_ID!,
    serviceUsername: values.SUPERSET_SERVICE_USERNAME!,
    servicePassword: values.SUPERSET_SERVICE_PASSWORD!,
    guestTokenTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 300,
  };
}

export function isSupersetConfigured(env: NodeJS.ProcessEnv = process.env) {
  return loadSupersetConfig(env) !== null;
}
