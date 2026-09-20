# Power BI Embedded Integration

## Goal

Add Microsoft Power BI Embedded as the analytics presentation layer for the
existing fulfillment governance product without changing business workflow
surfaces.

## Boundaries

- Embed for customers using an app-owned service principal.
- Backend owns Entra client credentials and obtains the report metadata and
  Power BI embed token.
- Frontend receives only a short-lived embed token.
- Add `/analytics` and a business-facing "经营分析" navigation entry.
- Do not build charts, fake reports, RLS identities, or a report designer.
- The current Power BI scope is one configured workspace and report.

## Definition of Done

- Backend exposes authenticated `GET /api/v2/analytics/powerbi/embed-config`.
- Missing Power BI configuration returns a stable 503 state.
- Upstream authentication and report/token failures map to explicit codes.
- Frontend renders loading, not-configured, upstream-error, embed, provider
  error, refresh, and fullscreen states.
- Local tests and browser screenshot verification pass.
- Real report embedding remains unverified until real workspace/report
  credentials are supplied.
