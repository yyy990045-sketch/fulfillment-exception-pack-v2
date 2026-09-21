# Competition release notes

## Problem

The project demonstrates how a cross-system fulfillment shortfall can be detected, traced back to source evidence, governed by humans, executed under separation of duties, and read back into an outcome.

## What works locally

- the deterministic `production-shortfall` judge scenario;
- Evidence Trace and the evidence-broken gate;
- industrial simulator, UNS semantic mapping, source ledger, and replay/idempotency checks;
- RBAC/tenant isolation, human governance, execution read-back, backup and recovery drills;
- local dependency/SBOM/release checks added in this release line.

## What is simulated or contract-only

The industrial environment and source records are high-fidelity local simulation. open supOS/UNS, MQTT, Superset, Power BI, JEV, and real MES/ERP/QMS/WMS customer systems are not asserted as live verified runtimes by this release.

## Known limitations

- project license decision is still required;
- production customer, factory, MES, and real open supOS runtime verification remain false;
- optional external integrations are not hard dependencies of the core judge demo;
- the release package is pre-1.0 and requires owner review before public publication.
