import type {
  PowerBiConfig,
  PowerBiEmbedToken,
  PowerBiFetch,
  PowerBiReportMetadata,
} from "./types.js";
import { PowerBiError } from "./types.js";

const POWER_BI_API_BASE = "https://api.powerbi.com/v1.0/myorg";

function reportPath(config: PowerBiConfig, suffix = "") {
  return `${POWER_BI_API_BASE}/groups/${encodeURIComponent(config.workspaceId)}/reports/${encodeURIComponent(config.reportId)}${suffix}`;
}

async function readJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    throw new PowerBiError("POWERBI_UPSTREAM_FAILURE", 502, { cause: error });
  }
}

async function powerBiRequest(
  fetchImpl: PowerBiFetch,
  url: string,
  accessToken: string,
  init?: RequestInit,
) {
  try {
    return await fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      } as HeadersInit,
    });
  } catch (error) {
    throw new PowerBiError("POWERBI_UPSTREAM_FAILURE", 502, { cause: error });
  }
}

export async function getPowerBiReportMetadata(
  config: PowerBiConfig,
  accessToken: string,
  fetchImpl: PowerBiFetch = fetch,
): Promise<PowerBiReportMetadata> {
  const response = await powerBiRequest(fetchImpl, reportPath(config), accessToken);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PowerBiError("POWERBI_AUTH_FAILED", 502);
    }
    if (response.status === 404) {
      throw new PowerBiError("POWERBI_REPORT_NOT_FOUND", 502);
    }
    throw new PowerBiError("POWERBI_UPSTREAM_FAILURE", 502);
  }

  const payload = await readJson(response);
  const reportId = typeof payload.id === "string" ? payload.id.trim() : "";
  const embedUrl = typeof payload.embedUrl === "string" ? payload.embedUrl.trim() : "";
  const datasetId = typeof payload.datasetId === "string" ? payload.datasetId.trim() : undefined;
  if (!reportId || !embedUrl) {
    throw new PowerBiError("POWERBI_UPSTREAM_FAILURE", 502);
  }
  return { reportId, embedUrl, ...(datasetId ? { datasetId } : {}) };
}

export async function generatePowerBiEmbedToken(
  config: PowerBiConfig,
  accessToken: string,
  fetchImpl: PowerBiFetch = fetch,
): Promise<PowerBiEmbedToken> {
  const response = await powerBiRequest(fetchImpl, reportPath(config, "/GenerateToken"), accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessLevel: "View" }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PowerBiError("POWERBI_AUTH_FAILED", 502);
    }
    throw new PowerBiError("POWERBI_EMBED_TOKEN_FAILED", 502);
  }

  const payload = await readJson(response);
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  const expiration = typeof payload.expiration === "string" ? payload.expiration.trim() : "";
  const expirationMs = Date.parse(expiration);
  if (!token || !expiration || !Number.isFinite(expirationMs) || expirationMs <= Date.now()) {
    throw new PowerBiError("POWERBI_EMBED_TOKEN_FAILED", 502);
  }
  return { token, expiration };
}
