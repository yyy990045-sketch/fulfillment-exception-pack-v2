# Power BI Embedded Integration

## Status

```text
POWERBI_EMBED_IMPLEMENTED=true
POWERBI_LOCAL_UI_VERIFIED=true
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
  -> authenticated backend endpoint
  -> Microsoft Entra service principal
  -> Power BI REST API
  -> report metadata + Embed Token
  -> frontend Power BI embed
```

The browser never receives the Entra access token, client secret, certificate
private key, or Power BI administrator token.

## Authentication

The backend uses Microsoft Entra client credentials through `@azure/msal-node`
with the scope:

```text
https://analysis.windows.net/powerbi/api/.default
```

The Entra access token is cached in process and refreshed before its expiry.
The browser receives only a Power BI Embed Token with its expiration.

## Environment Variables

```text
POWERBI_TENANT_ID
POWERBI_CLIENT_ID
POWERBI_CLIENT_SECRET
POWERBI_WORKSPACE_ID
POWERBI_REPORT_ID
POWERBI_DATASET_ID
POWERBI_AUTHORITY_HOST
```

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
2. Loads the server-only Power BI configuration.
3. Acquires or reuses a cached Entra access token.
4. Calls the Power BI workspace report metadata API.
5. Calls the report `GenerateToken` API with `accessLevel: View`.
6. Returns `embedToken`, `embedUrl`, `reportId`, `tokenType`, and `expiresAt`.

The response is sent with `Cache-Control: no-store`.

Stable errors:

```text
POWERBI_NOT_CONFIGURED
POWERBI_AUTH_FAILED
POWERBI_REPORT_NOT_FOUND
POWERBI_EMBED_TOKEN_FAILED
POWERBI_UPSTREAM_FAILURE
```

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
- The Entra token is never sent to the browser.
- The embed token is short-lived and kept out of persistent storage.
- The API response is not cacheable.
- Logs and error responses do not contain credentials or authorization headers.
- No client secret input is exposed in the UI.

If a Content Security Policy is introduced, allow only the Power BI domains
required by the selected embed runtime instead of using a wildcard.

## Tenant and RLS Boundary

Power BI V1 uses one configured analytics workspace and one configured report.

```text
MULTITENANT_POWERBI_ISOLATION=false
POWERBI_RLS_IMPLEMENTED=false
```

The endpoint is authenticated and uses the current tenant only as an
application-side authorization boundary. It does not yet claim workspace-per-
tenant isolation or Power BI row-level security.

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
