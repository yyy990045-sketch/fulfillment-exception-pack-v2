#!/usr/bin/env node
/**
 * Superset 嵌入式看板真实链路验证（npm run superset:verify-embed）。
 *
 * 只验证真实链路，不做「iframe HTML 200 就算通过」的弱判定：
 *   1. Superset 栈 health
 *   2. 业务后端 providers（defaultProvider=superset）
 *   3. 业务后端签发 guest token（校验 claims：type / aud / exp）
 *   4. 嵌入页 /embedded/<uuid> 返回 200，并从 bootstrap 取出真实 dashboard id
 *   5. guest token 走 Superset REST API：
 *      /api/v1/me/、/api/v1/me/roles/、/api/v1/dashboard/<id>、
 *      /api/v1/dashboard/<id>/charts、/api/v1/dashboard/<id>/datasets
 *   6. POST /api/v1/chart/data 至少跑通一个真实查询并返回真实行
 *   7. 边界：错误租户 / 缺少 scope 必须被业务后端拒绝
 *   8. 边界：EmbeddedGuest 不能读非白名单 dataset / dashboard，不能写、不能用 SQL Lab
 *
 * 全程不打印任何密码、服务账号、完整 JWT 或完整 guest token。
 *
 * 用法：
 *   node scripts/verify-superset-embed.mjs
 *   APP_BASE=http://127.0.0.1:3411 AUTH_SECRET=<本地 pilot 值> node scripts/verify-superset-embed.mjs
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_BASE = (process.env.APP_BASE ?? "http://127.0.0.1:3411").replace(/\/+$/, "");
const APP_ORIGIN = new URL(APP_BASE).origin;
const ENV_PATH = resolve(process.env.SUPERSET_ENV_FILE ?? "deploy/superset/.env");
const TENANT = process.env.SUPERSET_VERIFY_TENANT ?? "demo-manufacturing";
const ACTOR = process.env.SUPERSET_VERIFY_ACTOR ?? "viewer";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "";

function loadEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const env = loadEnv(ENV_PATH);
let supersetDomain = (process.env.SUPERSET_DOMAIN ?? env.SUPERSET_DOMAIN ?? "").replace(/\/+$/, "");
if (!supersetDomain) throw new Error(`${ENV_PATH} 缺少 SUPERSET_DOMAIN`);

const results = [];
function record(name, ok, detail = {}) {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail.note ? `  ${detail.note}` : ""}`);
}
function note(name, text) {
  console.log(`INFO  ${name}  ${text}`);
}

async function request(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, ok: response.ok, text, payload };
}

function jwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: "verify-user",
    exp: Math.floor(Date.now() / 1000) + 300,
    roles: ["viewer"],
    ...claims,
  });
  const signature = createHmac("sha256", AUTH_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

// ---------------------------------------------------------------- 1. 栈 health
const health = await request(`${supersetDomain}/health`);
record("superset stack health = 200", health.status === 200, { status: health.status });

// ------------------------------------------------- 2. 业务后端 provider 选择
const providers = await request(`${APP_BASE}/api/v2/analytics/providers`, {
  headers: { accept: "application/json", "x-tenant-id": TENANT, "x-actor": ACTOR },
});
const defaultProvider = providers.payload?.defaultProvider ?? null;
const embedUuid = providers.payload?.providers?.superset?.dashboardId ?? env.SUPERSET_DASHBOARD_ID ?? "";
supersetDomain = (providers.payload?.providers?.superset?.supersetDomain ?? supersetDomain).replace(/\/+$/, "");
record("backend providers defaultProvider = superset", defaultProvider === "superset", {
  status: providers.status,
  note: `defaultProvider=${defaultProvider} embedUuidConfigured=${Boolean(embedUuid)}`,
});
if (!embedUuid) throw new Error("未取得 SUPERSET_DASHBOARD_ID，无法继续");

// --------------------------------------------- 3. 业务后端签发 guest token
const minted = await request(`${APP_BASE}/api/v2/analytics/superset/guest-token`, {
  headers: { accept: "application/json", "x-tenant-id": TENANT, "x-actor": ACTOR },
});
const guestToken = minted.payload?.guestToken ?? "";
const claims = (() => {
  const parts = guestToken.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
})();
const ttl = claims ? claims.exp - Math.floor(Date.now() / 1000) : -1;
record("guest token issued (200, no secret leaked)", minted.ok && Boolean(guestToken), {
  status: minted.status,
  note: claims ? `ttl=${ttl}s` : "token 不可解析",
});
record("guest token claims (type=guest / aud bound / not expired)", Boolean(
  claims
  && claims.type === "guest"
  && String(claims.aud).replace(/\/+$/, "") === supersetDomain
  && ttl > 0,
), {
  status: minted.status,
  note: `type=${claims?.type} aud=${claims?.aud} exp_in=${ttl}s resources=${Array.isArray(claims?.resources) ? claims.resources.length : 0}`,
});
if (!guestToken) throw new Error("未取得 guest token，无法继续");

// ------------------------------- 4. 嵌入页 200 + bootstrap 里的 dashboard id
const embedded = await request(`${supersetDomain}/embedded/${embedUuid}?guest_token=${encodeURIComponent(guestToken)}`, {
  headers: { accept: "text/html", referer: `${APP_ORIGIN}/` },
});
record("embedded page /embedded/<uuid> = 200", embedded.status === 200, { status: embedded.status });
// Superset 6.1 的嵌入页把数字 dashboard id 通过 bootstrap 交给 SPA；
// /api/v1/dashboard/<数字 id>/... 才是嵌入应用真正调用的路径。
const dashboardId = Number(
  /dashboard_id(?:&#34;|"|\\")\s*:\s*(\d+)/.exec(embedded.text)?.[1] ?? NaN,
);
record("embedded bootstrap exposes numeric dashboard id", Number.isFinite(dashboardId), {
  status: embedded.status,
  note: `dashboardId=${Number.isFinite(dashboardId) ? dashboardId : "N/A"}`,
});
if (!Number.isFinite(dashboardId)) throw new Error("嵌入页未给出数字 dashboard id，无法继续");

const guestHeaders = {
  accept: "application/json",
  "x-guesttoken": guestToken,
  referer: `${APP_ORIGIN}/`,
};

async function probeGuest(name, path, init = {}) {
  const response = await request(`${supersetDomain}${path}`, { ...init, headers: init.headers ?? guestHeaders });
  record(name, response.status === 200, {
    status: response.status,
    note: response.status === 200 ? "" : `body=${response.text.slice(0, 110)}`,
  });
  return response;
}

// -------------------------------- 5. 嵌入应用启动时调用的 Superset REST API
await probeGuest("GET /api/v1/me/ = 200", "/api/v1/me/");
await probeGuest("GET /api/v1/me/roles/ = 200", "/api/v1/me/roles/");
const dashboard = await probeGuest(`GET /api/v1/dashboard/${dashboardId} = 200`, `/api/v1/dashboard/${dashboardId}`);
void dashboard;
const charts = await probeGuest(`GET /api/v1/dashboard/${dashboardId}/charts = 200`, `/api/v1/dashboard/${dashboardId}/charts`);
const datasets = await probeGuest(`GET /api/v1/dashboard/${dashboardId}/datasets = 200`, `/api/v1/dashboard/${dashboardId}/datasets`);

const chartCount = charts?.payload?.result?.length ?? 0;
record("dashboard exposes its charts (dashboard_slices wired)", chartCount > 0, {
  status: charts?.status ?? 0,
  note: `charts=${chartCount}`,
});
const datasetIds = (datasets?.payload?.result ?? []).map((item) => item.id);
record("dashboard exposes its datasets", datasetIds.length > 0, {
  status: datasets?.status ?? 0,
  note: `datasets=${datasetIds.join(",")}`,
});

// ------------------------------------- 6. 真实数据查询 POST /api/v1/chart/data
const datasetId = datasetIds[0] ?? null;
const chartData = datasetId
  ? await probeGuest("POST /api/v1/chart/data = 200", "/api/v1/chart/data", {
    method: "POST",
    headers: { ...guestHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      datasource: { id: datasetId, type: "table" },
      force: false,
      queries: [{
        granularity: null,
        groupby: [],
        metrics: [{ expressionType: "SQL", sqlExpression: "COUNT(*)", label: "rows" }],
        filters: [],
        row_limit: 10,
        time_range: "No filter",
        is_timeseries: false,
      }],
      result_format: "json",
      result_type: "full",
      form_data: {
        datasource: `${datasetId}__table`,
        viz_type: "table",
        dashboardId,
      },
    }),
  })
  : null;
const rows = chartData?.payload?.result?.[0]?.data?.length ?? 0;
record("chart data returns real rows", rows > 0, { status: chartData?.status ?? 0, note: `rows=${rows}` });

// ------------------------------------------- 7. 租户 / scope 边界（业务后端）
if (AUTH_SECRET.length >= 32) {
  const wrongScope = await request(`${APP_BASE}/api/v2/analytics/superset/guest-token`, {
    headers: { accept: "application/json", authorization: `Bearer ${jwt({ tenant_id: TENANT, scopes: ["fulfillment:sales"] })}` },
  });
  record("wrong scope -> 403 scope_forbidden", wrongScope.status === 403 && wrongScope.payload?.error === "scope_forbidden", {
    status: wrongScope.status,
    note: `error=${wrongScope.payload?.error}`,
  });
  const wrongTenant = await request(`${APP_BASE}/api/v2/analytics/superset/guest-token`, {
    headers: { accept: "application/json", authorization: `Bearer ${jwt({ tenant_id: "other-tenant", scopes: ["analytics:read"] })}` },
  });
  record("wrong tenant -> 403 SUPERSET_TENANT_FORBIDDEN", wrongTenant.status === 403 && wrongTenant.payload?.error === "SUPERSET_TENANT_FORBIDDEN", {
    status: wrongTenant.status,
    note: `error=${wrongTenant.payload?.error}`,
  });
  const rightTenant = await request(`${APP_BASE}/api/v2/analytics/superset/guest-token`, {
    headers: { accept: "application/json", authorization: `Bearer ${jwt({ tenant_id: TENANT, scopes: ["analytics:read"] })}` },
  });
  record("correct tenant + scope -> 200 guest token", rightTenant.status === 200 && Boolean(rightTenant.payload?.guestToken), {
    status: rightTenant.status,
  });
} else {
  note("tenant/scope boundary", "未设置 AUTH_SECRET（>=32 字符），跳过 JWT 分支；「未登录 -> 401」由 tests/superset-guest-token-http.test.ts 覆盖");
}

// ------------------------- 8. EmbeddedGuest 授权收窄（不能越界读 / 不能写）
async function expectDenied(name, path, init) {
  const response = await request(`${supersetDomain}${path}`, { ...init, headers: init?.headers ?? guestHeaders });
  // 401/403/404 都是「没有被授权」；写请求在 Superset 里会先被 CSRF 拦成 400，
  // 说明请求根本没有进入执行路径，同样算拒绝。任何 2xx 都视为越权。
  const denied = [400, 401, 403, 404].includes(response.status);
  record(name, denied, {
    status: response.status,
    note: `body=${response.text.slice(0, 80)}`,
  });
  return response;
}
const otherDashboard = await expectDenied("guest cannot read a non-allowlisted dashboard", "/api/v1/dashboard/9999");
const otherDataset = await expectDenied("guest cannot read a non-allowlisted dataset", "/api/v1/dataset/9999");
await expectDenied("guest cannot write a dashboard", `/api/v1/dashboard/${dashboardId}`, {
  method: "PUT",
  headers: { ...guestHeaders, "content-type": "application/json" },
  body: JSON.stringify({ dashboard_title: "guest-must-not-write" }),
});
await expectDenied("guest has no SQL Lab access", "/api/v1/sqllab/execute/", {
  method: "POST",
  headers: { ...guestHeaders, "content-type": "application/json" },
  body: JSON.stringify({ database_id: 1, sql: "select 1", json: true, runAsync: false }),
});
note("other resources", `non-allowlisted dashboard=${otherDashboard.status} dataset=${otherDataset.status}`);

const failed = results.filter((item) => !item.ok);
console.log("");
console.log(JSON.stringify({
  supersetDomain,
  appBase: APP_BASE,
  embedUuid,
  dashboardId,
  datasetIds,
  chartCount,
  checks: results.length,
  failed: failed.map((item) => item.name),
  pass: failed.length === 0,
}, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
