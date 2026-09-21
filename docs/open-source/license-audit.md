# License decision audit

Status: `LICENSE_DECISION_REQUIRED`

The repository at baseline `c198add5093be2d27fbd26757dd6cd5c1489ecce` has no project `LICENSE` or `NOTICE`. This release work therefore does not create a license file or declare a package license without owner approval.

## Candidates requiring owner decision

| Candidate | Compatibility signal | Main obligations / risk |
| --- | --- | --- |
| MIT | Compatible with the observed permissive dependency set in a preliminary review | Preserve copyright/license notices; does not automatically resolve copied or adapted upstream source obligations |
| Apache-2.0 | Compatible with the observed permissive dependency set in a preliminary review | Preserve notices and license text; include NOTICE where applicable; patent terms and contribution language need owner/legal approval |
| No license yet | Safest current truth boundary | Public users receive no implied permission to reuse the project; submission packaging cannot honestly claim an open-source license |

## Dependency evidence

`package-lock.json` reports metadata for 430 package entries. The observed dependency license values are recorded by `npm run sbom` and `docs/open-source/third-party-dependencies.md`; missing dependency license metadata was not found in the current lockfile scan. That does not decide the project license and does not audit copied source.

## Checks still required before choosing

- owner decision on the project license;
- review of any copied or adapted source under `src/`, `frontend/`, `scripts/`, and `deploy/`;
- review of vendor notices and generated submission materials;
- decision whether third-party assets or documents in `submission/` are distributable.

Until those decisions are recorded, `npm run licenses:verify` must fail closed with `LICENSE_AUDIT_BLOCKED`.
