import { loadSupersetConfig } from "./config.js";
import type { SupersetAuthContext, SupersetConfig, SupersetFetch, SupersetGuestToken } from "./types.js";
import { SupersetError } from "./types.js";

export type SupersetServiceDependencies = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: SupersetFetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Superset 的 guest_token 端点除了 Bearer 还要求 CSRF token 与登录产生的 session cookie
 * （官方文档示例同样是「登录 → 取 CSRF → 带 cookie 调 guest_token」三步）。
 * 这里只把 cookie 原样透传，不解析、不落盘、不返回给前端。
 */
function sessionCookies(response: Response) {
  const pairs: string[] = [];
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(";");
    if (pair && pair.includes("=")) pairs.push(pair.trim());
  }
  return pairs.join("; ");
}

function mergeCookies(...sources: string[]) {
  const jar = new Map<string, string>();
  for (const source of sources) {
    for (const pair of source.split(";")) {
      const trimmed = pair.trim();
      const index = trimmed.indexOf("=");
      if (index > 0) jar.set(trimmed.slice(0, index), trimmed.slice(index + 1));
    }
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function requestInit(init: RequestInit, timeoutMs: number): RequestInit {
  return { ...init, signal: AbortSignal.timeout(timeoutMs) };
}

async function readJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    throw new SupersetError("SUPERSET_UPSTREAM_FAILURE", 502, { cause: error });
  }
}

/** 服务账号登录（client credentials 形态的官方 REST 调用），只返回 access token。 */
async function login(config: SupersetConfig, fetchImpl: SupersetFetch, timeoutMs: number) {
  const response = await fetchImpl(`${config.domain}/api/v1/security/login`, requestInit({
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      username: config.serviceUsername,
      password: config.servicePassword,
      provider: "db",
      refresh: false,
    }),
  }, timeoutMs));
  if (!response.ok) throw new SupersetError("SUPERSET_AUTH_FAILED", 502);
  const payload = await readJson(response);
  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) throw new SupersetError("SUPERSET_AUTH_FAILED", 502);
  return { accessToken, cookie: sessionCookies(response) };
}

async function fetchCsrfToken(
  config: SupersetConfig,
  accessToken: string,
  cookie: string,
  fetchImpl: SupersetFetch,
  timeoutMs: number,
) {
  const response = await fetchImpl(`${config.domain}/api/v1/security/csrf_token/`, requestInit({
    method: "GET",
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}`, cookie },
  }, timeoutMs));
  if (!response.ok) throw new SupersetError("SUPERSET_AUTH_FAILED", 502);
  const payload = await readJson(response);
  const token = typeof payload.result === "string" ? payload.result.trim() : "";
  if (!token) throw new SupersetError("SUPERSET_AUTH_FAILED", 502);
  // CSRF token 绑定在本次请求建立的 session 上，必须把这个 cookie 一起带到下游
  return { csrfToken: token, cookie: mergeCookies(cookie, sessionCookies(response)) };
}

async function mintGuestToken(
  config: SupersetConfig,
  auth: SupersetAuthContext,
  accessToken: string,
  csrfToken: string,
  cookie: string,
  fetchImpl: SupersetFetch,
  timeoutMs: number,
) {
  const response = await fetchImpl(`${config.domain}/api/v1/security/guest_token/`, requestInit({
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      cookie,
      "x-csrftoken": csrfToken,
      referer: `${config.domain}/`,
    },
    body: JSON.stringify({
      // 单租户 pilot：只授权配置中绑定的那一个 dashboard，不下发跨租户资源
      resources: [{ type: "dashboard", id: config.dashboardId }],
      // RLS 不在本轮范围：投影按单租户导出，因此这里不声明 rls 规则
      rls: [],
      user: {
        username: `fep:${auth.tenantId}${auth.subjectId ? `:${auth.subjectId}` : ""}`,
        first_name: "Fulfillment",
        last_name: "Viewer",
      },
    }),
  }, timeoutMs));
  if (!response.ok) {
    // 上游细节可能包含库表名，统一收敛为稳定错误码，避免泄漏
    throw new SupersetError("SUPERSET_GUEST_TOKEN_FAILED", 502);
  }
  const payload = await readJson(response);
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  if (!token) throw new SupersetError("SUPERSET_GUEST_TOKEN_FAILED", 502);
  return token;
}

/**
 * 为当前产品租户签发嵌入用 guest token。
 * 顺序固定：未配置 → 租户边界 → 服务账号登录 → CSRF → guest token。
 * 返回值只包含 dashboardId / supersetDomain / guestToken / 过期秒数，
 * 绝不回传服务账号、secret 或 Superset 的 admin access token。
 */
export async function resolveSupersetGuestToken(
  auth: SupersetAuthContext,
  dependencies: SupersetServiceDependencies = {},
): Promise<SupersetGuestToken> {
  const config = loadSupersetConfig(dependencies.env);
  if (!config) throw new SupersetError("SUPERSET_NOT_CONFIGURED", 503);

  if (auth.tenantId !== config.productTenantId) {
    throw new SupersetError("SUPERSET_TENANT_FORBIDDEN", 403);
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { accessToken, cookie } = await login(config, fetchImpl, timeoutMs);
  const csrf = await fetchCsrfToken(config, accessToken, cookie, fetchImpl, timeoutMs);
  const guestToken = await mintGuestToken(
    config, auth, accessToken, csrf.csrfToken, csrf.cookie, fetchImpl, timeoutMs,
  );

  return {
    dashboardId: config.dashboardId,
    supersetDomain: config.domain,
    guestToken,
    expiresInSeconds: config.guestTokenTtlSeconds,
  };
}
