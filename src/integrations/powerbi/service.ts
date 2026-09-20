import { getEntraTokenProvider } from "./auth.js";
import { generatePowerBiEmbedToken, getPowerBiReportMetadata } from "./client.js";
import { loadPowerBiConfig } from "./config.js";
import type { EntraTokenProvider, PowerBiEmbedConfig, PowerBiFetch } from "./types.js";
import { PowerBiError } from "./types.js";

export type PowerBiServiceDependencies = {
  env?: NodeJS.ProcessEnv;
  tokenProvider?: EntraTokenProvider;
  fetchImpl?: PowerBiFetch;
};

export async function resolvePowerBiEmbedConfig(
  auth: { tenantId: string },
  dependencies: PowerBiServiceDependencies = {},
): Promise<PowerBiEmbedConfig> {
  const config = loadPowerBiConfig(dependencies.env);
  if (!config) throw new PowerBiError("POWERBI_NOT_CONFIGURED", 503);

  // The current product tenant is the application-side authorization boundary for the
  // single configured workspace/report. A different tenant fails closed instead of being
  // mapped onto the same report.
  if (auth.tenantId !== config.productTenantId) {
    throw new PowerBiError("POWERBI_TENANT_FORBIDDEN", 403);
  }

  const tokenProvider = dependencies.tokenProvider ?? getEntraTokenProvider(config);
  let accessToken: string;
  try {
    accessToken = await tokenProvider.getAccessToken();
  } catch (error) {
    if (error instanceof PowerBiError) throw error;
    throw new PowerBiError("POWERBI_AUTH_FAILED", 502, { cause: error });
  }

  const metadata = await getPowerBiReportMetadata(config, accessToken, dependencies.fetchImpl);
  const embedToken = await generatePowerBiEmbedToken(config, accessToken, dependencies.fetchImpl);
  return {
    configured: true,
    reportId: metadata.reportId,
    embedUrl: metadata.embedUrl,
    embedToken: embedToken.token,
    tokenType: "Embed",
    expiresAt: embedToken.expiration,
    ...(metadata.datasetId ? { datasetId: metadata.datasetId } : {}),
  };
}
