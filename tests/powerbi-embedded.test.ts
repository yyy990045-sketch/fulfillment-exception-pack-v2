import { describe, expect, it, vi } from "vitest";
import { createEntraTokenProvider, getEntraTokenProvider } from "../src/integrations/powerbi/auth.js";
import {
  generatePowerBiEmbedToken,
  getPowerBiReportMetadata,
} from "../src/integrations/powerbi/client.js";
import { loadPowerBiConfig } from "../src/integrations/powerbi/config.js";
import { resolvePowerBiEmbedConfig } from "../src/integrations/powerbi/service.js";
import type { PowerBiFetch } from "../src/integrations/powerbi/types.js";

const env = {
  POWERBI_TENANT_ID: "entra-tenant-id",
  POWERBI_PRODUCT_TENANT_ID: "product-tenant",
  POWERBI_CLIENT_ID: "client-id",
  POWERBI_CLIENT_SECRET: "server-secret",
  POWERBI_WORKSPACE_ID: "workspace-id",
  POWERBI_REPORT_ID: "report-id",
} as NodeJS.ProcessEnv;

function config() {
  const value = loadPowerBiConfig(env);
  if (!value) throw new Error("test_config_missing");
  return value;
}

describe("Power BI Embedded backend", () => {
  it("requires the complete server-side configuration", () => {
    expect(loadPowerBiConfig({})).toBeNull();
    expect(loadPowerBiConfig({ ...env, POWERBI_CLIENT_SECRET: "" })).toBeNull();
    expect(loadPowerBiConfig({ ...env, POWERBI_PRODUCT_TENANT_ID: "" })).toBeNull();
    expect(loadPowerBiConfig(env)).toMatchObject({
      entraTenantId: "entra-tenant-id",
      productTenantId: "product-tenant",
      authorityHost: "https://login.microsoftonline.com",
    });
  });

  it("caches the Entra token and refreshes with a safety skew", async () => {
    let now = 1_000_000;
    const acquireTokenByClientCredential = vi.fn().mockResolvedValue({
      accessToken: "entra-access-token",
      expiresOn: new Date(now + 3_600_000),
    });
    const provider = createEntraTokenProvider(config(), {
      client: { acquireTokenByClientCredential },
      now: () => now,
      refreshSkewMs: 60_000,
    });

    await expect(provider.getAccessToken()).resolves.toBe("entra-access-token");
    await expect(provider.getAccessToken()).resolves.toBe("entra-access-token");
    expect(acquireTokenByClientCredential).toHaveBeenCalledTimes(1);

    now += 3_550_000;
    await expect(provider.getAccessToken()).resolves.toBe("entra-access-token");
    expect(acquireTokenByClientCredential).toHaveBeenCalledTimes(2);
  });

  it("reuses one token provider per configured Power BI target", () => {
    const value = config();
    expect(getEntraTokenProvider(value)).toBe(getEntraTokenProvider(value));
  });

  it("parses report metadata and an embed token without returning the Entra token", async () => {
    const fetchImpl = vi.fn<PowerBiFetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/GenerateToken")) {
        return new Response(JSON.stringify({
          token: "powerbi-embed-token",
          expiration: "2030-09-20T12:00:00.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        id: "report-id",
        embedUrl: "https://app.powerbi.com/reportEmbed?reportId=report-id",
        datasetId: "dataset-id",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await resolvePowerBiEmbedConfig(
      { tenantId: "product-tenant" },
      {
        env,
        tokenProvider: { getAccessToken: async () => "entra-access-token" },
        fetchImpl,
      },
    );

    expect(result).toMatchObject({
      configured: true,
      reportId: "report-id",
      embedToken: "powerbi-embed-token",
      tokenType: "Embed",
    });
    expect(JSON.stringify(result)).not.toContain("entra-access-token");
    expect(JSON.stringify(result)).not.toContain("server-secret");
    expect(JSON.stringify(result)).not.toContain("client-id");
    expect(JSON.stringify(result)).not.toContain("entra-tenant-id");
  });

  it("fails closed when the current product tenant is not bound to the configured report", async () => {
    const fetchImpl = vi.fn<PowerBiFetch>(async () => new Response("{}", { status: 200 }));
    const getAccessToken = vi.fn(async () => "entra-access-token");
    await expect(resolvePowerBiEmbedConfig(
      { tenantId: "other-product-tenant" },
      { env, tokenProvider: { getAccessToken }, fetchImpl },
    )).rejects.toMatchObject({ code: "POWERBI_TENANT_FORBIDDEN", status: 403 });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps upstream failures to stable Power BI error codes", async () => {
    const report = config();
    await expect(getPowerBiReportMetadata(
      report,
      "entra-access-token",
      vi.fn<PowerBiFetch>(async () => new Response("{}", { status: 404 })),
    )).rejects.toMatchObject({ code: "POWERBI_REPORT_NOT_FOUND", status: 502 });
    await expect(getPowerBiReportMetadata(
      report,
      "entra-access-token",
      vi.fn<PowerBiFetch>(async () => new Response("{}", { status: 401 })),
    )).rejects.toMatchObject({ code: "POWERBI_AUTH_FAILED", status: 502 });
    await expect(generatePowerBiEmbedToken(
      report,
      "entra-access-token",
      vi.fn<PowerBiFetch>(async () => new Response("{}", { status: 500 })),
    )).rejects.toMatchObject({ code: "POWERBI_EMBED_TOKEN_FAILED", status: 502 });
  });

  it("fails closed when configuration is absent", async () => {
    await expect(resolvePowerBiEmbedConfig(
      { tenantId: "product-tenant" },
      { env: {} },
    )).rejects.toMatchObject({ code: "POWERBI_NOT_CONFIGURED", status: 503 });
  });
});
