import { describe, expect, it, vi } from "vitest";
import { loadSupersetConfig } from "../src/integrations/superset/config.js";
import { resolveSupersetGuestToken } from "../src/integrations/superset/service.js";
import type { SupersetFetch } from "../src/integrations/superset/types.js";

const env = {
  SUPERSET_DOMAIN: "http://superset.test/",
  SUPERSET_DASHBOARD_ID: "dash-uuid",
  SUPERSET_PRODUCT_TENANT_ID: "demo-manufacturing",
  SUPERSET_SERVICE_USERNAME: "svc",
  SUPERSET_SERVICE_PASSWORD: "service-password",
  SUPERSET_GUEST_TOKEN_TTL: "240",
} as NodeJS.ProcessEnv;

/**
 * 桩 Superset：精确复刻真实契约——guest_token 必须同时带 Bearer、CSRF 与
 * csrf_token 调用建立的 session cookie，否则返回 400（这正是真实实现踩过的坑）。
 */
function stubSuperset() {
  const requests: string[] = [];
  const fetchImpl = vi.fn<SupersetFetch>(async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push(url.replace("http://superset.test", ""));
    if (url.endsWith("/api/v1/security/login")) {
      return new Response(JSON.stringify({ access_token: "admin-access-token" }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "login=1; Path=/" },
      });
    }
    if (url.endsWith("/api/v1/security/csrf_token/")) {
      if (headers.authorization !== "Bearer admin-access-token") return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ result: "csrf-token" }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "session=abc; Path=/" },
      });
    }
    if (url.endsWith("/api/v1/security/guest_token/")) {
      const hasCookie = String(headers.cookie ?? "").includes("session=abc");
      const hasCsrf = headers["x-csrftoken"] === "csrf-token";
      if (!hasCookie || !hasCsrf) {
        return new Response(JSON.stringify({ errors: [{ message: "The CSRF session token is missing." }] }), { status: 400 });
      }
      return new Response(JSON.stringify({ token: "guest.jwt.token" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, requests };
}

describe("Superset embedded integration", () => {
  it("requires the full server-side configuration", () => {
    expect(loadSupersetConfig({})).toBeNull();
    expect(loadSupersetConfig({ ...env, SUPERSET_SERVICE_PASSWORD: "" })).toBeNull();
    expect(loadSupersetConfig({ ...env, SUPERSET_DASHBOARD_ID: "" })).toBeNull();
    expect(loadSupersetConfig(env)).toMatchObject({
      domain: "http://superset.test",
      dashboardId: "dash-uuid",
      productTenantId: "demo-manufacturing",
      guestTokenTtlSeconds: 240,
    });
  });

  it("fails closed when configuration is absent", async () => {
    await expect(resolveSupersetGuestToken(
      { tenantId: "demo-manufacturing" },
      { env: {} },
    )).rejects.toMatchObject({ code: "SUPERSET_NOT_CONFIGURED", status: 503 });
  });

  it("rejects another product tenant before contacting Superset", async () => {
    const { fetchImpl } = stubSuperset();
    await expect(resolveSupersetGuestToken(
      { tenantId: "other-tenant" },
      { env, fetchImpl },
    )).rejects.toMatchObject({ code: "SUPERSET_TENANT_FORBIDDEN", status: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("mints a guest token with the session cookie and CSRF token, and leaks nothing", async () => {
    const { fetchImpl, requests } = stubSuperset();
    const result = await resolveSupersetGuestToken(
      { tenantId: "demo-manufacturing", subjectId: "user-1" },
      { env, fetchImpl },
    );

    expect(requests).toEqual([
      "/api/v1/security/login",
      "/api/v1/security/csrf_token/",
      "/api/v1/security/guest_token/",
    ]);
    expect(result).toEqual({
      dashboardId: "dash-uuid",
      supersetDomain: "http://superset.test",
      guestToken: "guest.jwt.token",
      expiresInSeconds: 240,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("service-password");
    expect(serialized).not.toContain("admin-access-token");
    expect(serialized).not.toContain("csrf-token");
  });

  it("maps upstream failures to a stable error code without echoing upstream detail", async () => {
    const fetchImpl = vi.fn<SupersetFetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/login")) return new Response(JSON.stringify({ access_token: "admin-access-token" }), { status: 200 });
      if (url.endsWith("/csrf_token/")) return new Response(JSON.stringify({ result: "csrf-token" }), { status: 200 });
      return new Response(JSON.stringify({ errors: [{ message: "internal detail with table names" }] }), { status: 403 });
    });

    await expect(resolveSupersetGuestToken(
      { tenantId: "demo-manufacturing" },
      { env, fetchImpl },
    )).rejects.toMatchObject({ code: "SUPERSET_GUEST_TOKEN_FAILED", status: 502 });
  });
});
