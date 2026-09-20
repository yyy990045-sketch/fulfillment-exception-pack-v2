export type SupersetConfig = {
  domain: string;
  dashboardId: string;
  productTenantId: string;
  serviceUsername: string;
  servicePassword: string;
  guestTokenTtlSeconds: number;
};

export type SupersetGuestToken = {
  dashboardId: string;
  supersetDomain: string;
  guestToken: string;
  expiresInSeconds: number;
};

export type SupersetErrorCode =
  | "SUPERSET_NOT_CONFIGURED"
  | "SUPERSET_TENANT_FORBIDDEN"
  | "SUPERSET_AUTH_FAILED"
  | "SUPERSET_GUEST_TOKEN_FAILED"
  | "SUPERSET_UPSTREAM_FAILURE";

export class SupersetError extends Error {
  constructor(
    public readonly code: SupersetErrorCode,
    public readonly status: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "SupersetError";
  }
}

export type SupersetFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SupersetAuthContext = {
  tenantId: string;
  subjectId?: string;
};
