import { ConfidentialClientApplication } from "@azure/msal-node";
import type { EntraTokenProvider, PowerBiConfig } from "./types.js";
import { PowerBiError } from "./types.js";

const POWER_BI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const DEFAULT_REFRESH_SKEW_MS = 60_000;
const sharedProviders = new Map<string, EntraTokenProvider>();

type TokenClient = Pick<ConfidentialClientApplication, "acquireTokenByClientCredential">;

export type EntraTokenProviderDependencies = {
  client?: TokenClient;
  now?: () => number;
  refreshSkewMs?: number;
};

export function createEntraTokenProvider(
  config: PowerBiConfig,
  dependencies: EntraTokenProviderDependencies = {},
): EntraTokenProvider {
  const client = dependencies.client ?? new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `${config.authorityHost}/${config.entraTenantId}`,
      clientSecret: config.clientSecret,
    },
    system: {
      loggerOptions: {
        piiLoggingEnabled: false,
        loggerCallback: () => undefined,
      },
    },
  });
  const now = dependencies.now ?? Date.now;
  const refreshSkewMs = dependencies.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  let cached: { accessToken: string; expiresAtMs: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function acquire() {
    const result = await client.acquireTokenByClientCredential({ scopes: [POWER_BI_SCOPE] });
    if (!result?.accessToken) {
      throw new PowerBiError("POWERBI_AUTH_FAILED", 502);
    }
    cached = {
      accessToken: result.accessToken,
      expiresAtMs: result.expiresOn?.getTime() ?? now() + 5 * 60_000,
    };
    return result.accessToken;
  }

  return {
    async getAccessToken() {
      if (cached && now() + refreshSkewMs < cached.expiresAtMs) return cached.accessToken;
      if (inFlight) return inFlight;
      inFlight = acquire().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

export function getEntraTokenProvider(config: PowerBiConfig): EntraTokenProvider {
  // Secret rotation requires a process restart: the cache key intentionally
  // binds authority, Entra tenant, client, workspace, and report, not the secret.
  const key = [
    config.authorityHost,
    config.entraTenantId,
    config.clientId,
    config.workspaceId,
    config.reportId,
  ].join(":");
  const existing = sharedProviders.get(key);
  if (existing) return existing;
  const provider = createEntraTokenProvider(config);
  sharedProviders.set(key, provider);
  return provider;
}
