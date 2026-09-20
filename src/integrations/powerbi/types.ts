export type PowerBiConfig = {
  entraTenantId: string;
  productTenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
  reportId: string;
  datasetId?: string;
  authorityHost: string;
};

export type PowerBiReportMetadata = {
  reportId: string;
  embedUrl: string;
  datasetId?: string;
};

export type PowerBiEmbedToken = {
  token: string;
  expiration: string;
};

export type PowerBiEmbedConfig = {
  configured: true;
  reportId: string;
  embedUrl: string;
  embedToken: string;
  tokenType: "Embed";
  expiresAt: string;
  datasetId?: string;
};

export type PowerBiErrorCode =
  | "POWERBI_NOT_CONFIGURED"
  | "POWERBI_TENANT_FORBIDDEN"
  | "POWERBI_AUTH_FAILED"
  | "POWERBI_REPORT_NOT_FOUND"
  | "POWERBI_EMBED_TOKEN_FAILED"
  | "POWERBI_UPSTREAM_FAILURE";

export class PowerBiError extends Error {
  constructor(
    public readonly code: PowerBiErrorCode,
    public readonly status: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "PowerBiError";
  }
}

export type EntraTokenProvider = {
  getAccessToken(): Promise<string>;
};

export type PowerBiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
