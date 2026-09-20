# Implementation Plan

1. Add the server-only Power BI integration module with environment parsing,
   Entra client-credential token caching, report metadata retrieval, report
   embed-token retrieval, and stable error mapping.
2. Add the authenticated embed-config endpoint and OpenAPI contract.
3. Add the React analytics route, query hook, embed lifecycle, token refresh,
   fullscreen action, and explicit availability/error states.
4. Add backend and frontend tests plus the optional `.env.example` variables.
5. Add architecture, security, tenant-boundary, capacity, and live-verification
   documentation.
6. Run the full verification suite and capture the real browser not-configured
   screenshot.
7. Commit only the Power BI integration and task archive; preserve unrelated
   working-tree changes.
