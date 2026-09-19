# Plan

1. Inspect the live EGo DOM, computed geometry, loaded asset hash, and API response.
2. Add migration 015 and explicit Pack Context binding persistence.
3. Bind demo/provisioned contexts before rule evaluation and fail closed on conflicts.
4. Rebuild, restart, and verify the real runtime and API after a cold start.
5. Add runtime regression assertions, capture screenshots, run full regression, commit, and push.
