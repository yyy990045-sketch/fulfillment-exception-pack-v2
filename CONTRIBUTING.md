# Contributing

## Local setup

Use Node `>=22.5.0`, then run `npm ci`. Keep secrets in ignored `.env.*` files; commit only the provided example templates.

## Change flow

Create a focused branch, make the smallest change that satisfies the requirement, and run relevant tests plus `npm run typecheck`. Pull requests must include documentation and truth-boundary updates when a claim or integration status changes.

## Architecture and evidence boundary

Keep domain packs declarative, keep connector/provider code behind its integration boundary, and preserve tenant isolation, evidence provenance, and human approval gates. `SIMULATED`, `LOCAL_VERIFIED`, and `CONTRACT_VERIFIED` must remain distinct from real factory, customer, and production claims.

## Pull requests

Run applicable backend/frontend tests, `npm run typecheck`, `npm run truth:audit`, and `git diff --check`. Describe migrations, security impact, tenant-isolation impact, provenance changes, and whether any integration was tested against a real runtime or only a contract/local fixture.
