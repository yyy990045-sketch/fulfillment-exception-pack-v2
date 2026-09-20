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
  _auth: { tenantId: string },
  dependencies: PowerBiServiceDependencies = {},
): Promise<PowerBiEmbedConfig> {
  const config = loadPowerBiConfig(dependencies.env);
  if (!config) throw new PowerBiError("POWERBI_NOT_CONFIGURED", 503);

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
