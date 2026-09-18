# Stage 5B1 Open supOS Runtime Verification

## 1 Upstream Provenance

- Official repository: `https://gitee.com/supos-community-edition/supos-ce-deploy.git`
- Branch: `master`
- Exact commit: `9272ef5f124f317f902a7a6d2302a22a8c2467e3`
- Commit time: `2026-09-14T14:50:47+08:00`
- Clone/fetch date: `2026-09-18`

The clone was used only as an external runtime source. It is not vendored into this repository.

## 2 Host

The local audit host is:

- macOS 27.0
- arm64
- Docker 29.6.1
- Docker Compose v5.2.0
- Node.js v24.18.0
- 24 GiB RAM
- 132 GiB free disk

The official deployment repository currently documents and tests Ubuntu Server 24.04 and Windows. It does not document macOS as a supported deployment target.

A Linux Docker host was previously identified for this task, but its recorded resources were below the official `4c8g` profile: 4 CPUs, approximately 3.6 GiB total RAM, and approximately 2.3 GiB available RAM. This run could not re-establish a supported SSH path to that host. No services were stopped to make room.

## 3 Services

Official Open supOS services were not started.

```text
docker compose ps
```

was therefore not available for an official runtime.

The current official compose files reference these expected components:

- backend
- frontend/static deployment
- nginx gateway
- EMQX
- Node-RED
- PostgreSQL / TimescaleDB
- Keycloak
- MinIO
- Portainer
- optional profile services

No service is claimed as running.

## 4 MQTT Listener

The official compose files declare an EMQX listener mapping for port `1883`. They also declare TLS, WebSocket, and dashboard ports. This is static upstream configuration evidence only.

No MQTT listener was started or connected to.

## 5 Real Broker Probe

Not executed.

The verifier is designed to run a unique namespace probe:

```text
fulfillment-runtime-probe/{run-id}
```

The probe must connect, subscribe with ACK, publish, and receive before any SO-MFG message is sent.

## 6 Real SO-MFG Inbound

Not executed.

The intended path is:

```text
buildSoMfg001UnsMessages()
  -> OpenSupOSMqttTransport
  -> real Open supOS MQTT broker
  -> configured subscriber
  -> OpenSupOSAdapter
  -> fresh SQLite
```

Direct `adapter.ingest()` and `InMemoryUnsTransport` are not accepted by the real verification command.

## 7 Rebuilt Manufacturing Thread

Not produced from a real runtime.

Expected target counts remain:

```text
Context = 1
SourceSystems = 7
Entities = 8
EntityReferences = 8
Documents = 8
Events = 11
Evidence = 11
```

## 8 Rule Results

Not run against a runtime-rebuilt database.

Expected target result remains:

```text
Evaluations = 7
MATCHED = 4
NOT_MATCHED = 3
Exceptions = 4
ResolutionCases = 0
```

The future verifier provisions only the manufacturing rule catalog after MQTT fact ingestion. It does not provision fixture facts.

## 9 Duplicate Delivery

Not executed against a real broker.

The verifier is prepared to publish the same 11 messages a second time and require unchanged counts for Documents, Events, and Evidence.

## 10 UNS Visibility

```text
UNS_VISIBILITY_NOT_VERIFIED
```

No claim is made that the topics appear in the Open supOS UNS tree automatically. No namespace, model, topic, or Source Flow was created.

## 11 OpenAPI Discovery

```text
OPEN_API_DISCOVERY_NOT_VERIFIED
```

No gateway or backend route behavior is claimed without a running runtime.

## 12 Known Platform Issues

- The English README references `bin/startup.sh`, but the audited commit contains `bin/install.sh`, not `startup.sh`.
- The Chinese README and actual installation script agree on `bin/install.sh`.
- The official image registry and deployment services are external dependencies; none were pulled during this blocked run.
- Public/default credentials in the upstream deployment repository were not used as verification credentials.

## 13 Truthfulness Boundary

```text
CODE_IMPLEMENTED = true
LOCAL_TESTED = true
REAL_OPEN_SUPOS_RUNTIME_VERIFIED = false
UNS_MODEL_VERIFIED = false
SOURCE_FLOW_VERIFIED = false
OUTBOUND_VERIFIED = false
```

## Runtime Tooling

The integration now includes:

```text
src/integrations/open-supos/runtime-verify.ts
npm run open-supos:verify
```

Without `OPEN_SUPOS_ENABLED=true`, the command returns:

```json
{
  "status": "disabled"
}
```

Real verification requires:

- `OPEN_SUPOS_MQTT_URL`
- `OPEN_SUPOS_UPSTREAM_COMMIT=9272ef5f124f317f902a7a6d2302a22a8c2467e3`
- `OPEN_SUPOS_RUNTIME_CONFIRMED=true`
- a fresh `PACK_STORE_DB`
- optional MQTT credentials
- separate publisher and subscriber client IDs

The verifier rejects public MQTT brokers, mismatched upstream commits, and identical publisher/subscriber client IDs. It records `runtimeVerified=true` only when the built-in MQTT transport is used. Test-injected transports produce `status=simulated` and `runtimeVerified=false`.

The command writes its raw report to `data/runtime/open-supos-verification.json`. A successful run writes the redacted summary to `docs/competition/runtime/open-supos-5b1-summary.json`.

## Blocker

```text
OPEN_SUPOS_RUNTIME_BLOCKED: INSUFFICIENT_RUNTIME_RESOURCES
```

The local host is not an officially documented deployment target. The previously identified Linux host is below the official minimum resource profile and was not safely reachable in this run. Starting an under-sized unofficial runtime and calling it verified would violate the fail-closed requirement.
