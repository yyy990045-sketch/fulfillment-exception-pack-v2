# Power BI Embedded Integration

## Status

```text
POWERBI_EMBED_IMPLEMENTED=true
POWERBI_LOCAL_UI_VERIFIED=true
POWERBI_SINGLE_TENANT_AUTHORIZATION_BOUNDARY=implemented
POWERBI_REAL_REPORT_VERIFIED=false
POWERBI_RLS_IMPLEMENTED=false
POWERBI_RLS_VERIFIED=false
POWERBI_MULTITENANT_ISOLATION_VERIFIED=false
POWERBI_PRODUCTION_CAPACITY_VERIFIED=false
LIVE_VERIFICATION_STATUS=BLOCKED_BY_CONFIGURATION
```

The code path is implemented and locally verifiable. No real Power BI
Workspace, Report, Entra application credential, semantic model, or capacity
has been supplied, so live report embedding is not verified.

## Architecture

The product keeps business context, Evidence, governance, Policy, Resolution,
Execution, and Outcome in the existing application. Power BI is used only as
the analytics presentation layer.

```text
current product authentication
  -> analytics:read scope assertion
  -> current product tenant authorization boundary
  -> authenticated backend endpoint
  -> Microsoft Entra service principal
  -> Power BI REST API
  -> report metadata + Embed Token
  -> frontend Power BI embed
```

The browser never receives the Entra access token, client secret, certificate
private key, or Power BI administrator token.

The endpoint is fail-closed twice before any Power BI call is made: the caller
must hold the `analytics:read` scope, and the current product tenant must be the
one tenant bound to the configured report.

## Authentication

The backend uses Microsoft Entra client credentials through `@azure/msal-node`
with the scope:

```text
https://analysis.windows.net/powerbi/api/.default
```

The Entra access token is cached in process and refreshed before its expiry.
The browser receives only a Power BI Embed Token with its expiration.

The cached token provider is keyed by authority host, Entra tenant, client ID,
workspace ID, and report ID. Secret rotation requires a process restart; the
secret itself is deliberately not part of the cache key.

## Environment Variables

```text
POWERBI_TENANT_ID
POWERBI_PRODUCT_TENANT_ID
POWERBI_CLIENT_ID
POWERBI_CLIENT_SECRET
POWERBI_WORKSPACE_ID
POWERBI_REPORT_ID
POWERBI_DATASET_ID
POWERBI_AUTHORITY_HOST
```

`POWERBI_TENANT_ID` is the Microsoft Entra tenant that hosts the application
registration used for the service-principal token.

`POWERBI_PRODUCT_TENANT_ID` is a different identifier: it is the current product
tenant that is allowed to read this Power BI report. It is not an Entra tenant
ID and must not be populated with `POWERBI_TENANT_ID` by default. The endpoint
compares the authenticated product tenant against this value and fails closed on
any mismatch, so no product tenant is silently mapped onto the same report.
The demo-mode default tenant (`demo-manufacturing`) must not be reused here either.

`POWERBI_DATASET_ID` is optional metadata and does not bypass report metadata
lookup. `POWERBI_AUTHORITY_HOST` defaults to
`https://login.microsoftonline.com`.

Secrets are server-only. They must not be committed, logged, returned by an
API, persisted in browser storage, or placed in frontend environment files.

## Workspace Prerequisites

1. Create or select the Microsoft Entra application used by the backend.
2. Grant the service principal the minimum Power BI workspace/report access
   needed for read and embed-token generation.
3. Enable service principals to use Power BI APIs in the tenant's Power BI
   admin settings.
4. Place the report in the configured workspace.
5. Ensure the report has a supported capacity or development trial runtime.

The exact Power BI tenant policy and capacity decision must be confirmed in the
target tenant before production deployment.

## Embed Token Flow

`GET /api/v2/analytics/powerbi/embed-config`:

1. Authenticates the current product user.
2. Asserts the `analytics:read` scope on the authenticated context.
3. Loads the server-only Power BI configuration.
4. Fails closed unless the current product tenant equals `POWERBI_PRODUCT_TENANT_ID`.
5. Acquires or reuses a cached Entra access token.
6. Calls the Power BI workspace report metadata API.
7. Calls the report `GenerateToken` API with `accessLevel: View`.
8. Returns `embedToken`, `embedUrl`, `reportId`, `tokenType`, and `expiresAt`.

The response is sent with `Cache-Control: no-store`.

The response contract is unchanged: it never contains the Entra tenant ID, the
product tenant ID, the client ID, or any server-side credential.

Stable errors:

```text
POWERBI_NOT_CONFIGURED
POWERBI_TENANT_FORBIDDEN
POWERBI_AUTH_FAILED
POWERBI_REPORT_NOT_FOUND
POWERBI_EMBED_TOKEN_FAILED
POWERBI_UPSTREAM_FAILURE
```

`POWERBI_TENANT_FORBIDDEN` is returned with HTTP 403 before any Entra or Power BI
call is attempted.

## Frontend Embedding

The `/analytics` route and `/manufacturing/analytics` compatibility route render
the business page named `经营分析`.

The page:

- requests the backend embed configuration;
- embeds a report with `powerbi-client-react`;
- keeps the filters pane collapsed and page navigation visible;
- listens for loaded, rendered, error, and token-expired events;
- refreshes the embed token before expiry through the backend;
- provides refresh and fullscreen controls;
- shows explicit loading, not-configured, and upstream-error states.

It does not draw its own BI charts or fabricate a report.

## Security Boundary

- Authentication is required before any Power BI configuration is returned.
- The `analytics:read` scope is asserted before configuration, token, or report data is read.
- The current product tenant is the application-side authorization boundary for the configured report.
- The Entra token is never sent to the browser.
- The embed token is short-lived and kept out of persistent storage.
- The API response is not cacheable.
- Logs and error responses do not contain credentials or authorization headers.
- No client secret input is exposed in the UI.

If a Content Security Policy is introduced, allow only the Power BI domains
required by the selected embed runtime instead of using a wildcard.

## Tenant and RLS Boundary

Power BI V1 is a single-tenant binding, not a multi-tenant Power BI deployment:

```text
one product tenant (POWERBI_PRODUCT_TENANT_ID)
  -> one configured workspace
  -> one configured report
```

```text
MULTITENANT_POWERBI_ISOLATION=false
POWERBI_RLS_IMPLEMENTED=false
```

The single-tenant authorization boundary is implemented: the endpoint is
authenticated, requires `analytics:read`, and rejects any other product tenant
with `POWERBI_TENANT_FORBIDDEN` instead of mapping it onto the same report.
Because the deployment still serves exactly one product tenant and one report,
this is not Power BI tenant isolation and not Power BI row-level security.

Any additional product tenant fails closed until its own workspace/report
binding exists.

Future options:

- Workspace per tenant.
- Shared semantic model plus RLS.
- Service Principal Profiles.

The long-term SaaS direction is workspace-based isolation combined with
service principal profiles. These are architecture options, not implemented
claims in this phase.

## Production and Capacity

Development trial embedding is not production capacity. Production requires a
Power BI Embedded or Fabric-supported capacity appropriate to the tenant's
workload, region, and isolation requirements. Fabric F SKUs should be
evaluated first for new deployments, but no SKU is hard-coded here.

## Live Verification Checklist

Live verification is `BLOCKED_BY_CONFIGURATION` until the following are
provided and tested:

- real Entra tenant/application;
- server-side client credential;
- workspace ID and report ID;
- report metadata response;
- generated embed token with a valid expiration;
- browser load and render without a Power BI login prompt;
- refresh and token renewal;
- explicit RLS/effective identity mapping, if RLS is enabled;
- capacity validation against the intended production workload.

The local API and UI may be tested without credentials only for the
not-configured and failure-state behavior.
