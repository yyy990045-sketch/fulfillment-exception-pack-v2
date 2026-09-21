# Security policy

## Supported versions

Security fixes are considered for the latest commit on the competition release line. This repository is a pre-1.0 competition candidate, not a production support commitment.

## Reporting a vulnerability

Do not publish credentials, exploit details, personal data, or tenant data in a public issue. If GitHub private security advisories are enabled, use one. Otherwise contact the repository owner through the private repository channel before disclosure. No public email address is asserted here.

## Security boundaries

- Never commit `.env`, tokens, private keys, database credentials, JWT secrets, or customer exports.
- Use the production JWT boundary and tenant/role checks; demo compatibility headers are not production authentication.
- Treat evidence payloads, source URLs, logs, backups, and screenshots as potentially sensitive.
- Preserve evidence hashes, source provenance, replay/idempotency checks, and fail-closed traceability gates.
- Never describe a local simulator, contract test, or historical local dashboard verification as a live external system or production result.
