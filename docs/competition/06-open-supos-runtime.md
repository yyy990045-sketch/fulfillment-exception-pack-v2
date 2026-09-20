# Stage 5B1 Open supOS Runtime Verification

Audit date: `2026-09-19`

> 续审计（2026-09-20）：本文件的结论 `OPEN_SUPOS_RUNTIME_BLOCKED: NO_SUPPORTED_RUNTIME_HOST`
> 仍然成立，但其中「Docker daemon 不可用」这一条已过期（本机 Docker 现已可用）。
> 最新的证据、阻塞原因集合与解除方案以 `docs/open-supos-integration.md` 为准；
> 本文件保留为 2026-09-19 那一次审计的历史记录。

## 1 Upstream Provenance

- Official repository: `https://gitee.com/supos-community-edition/supos-ce-deploy.git`
- Audited branch: `master`
- Audited commit: `9272ef5f124f317f902a7a6d2302a22a8c2467e3`
- Provenance check: remote `HEAD` and `refs/heads/master` both resolve to the audited commit via `git ls-remote`
- Vendoring: the official deployment repository is not copied into this project

The audited commit was not changed.

## 2 Current Host

- OS: macOS `27.0`
- Architecture: `arm64`
- Node.js: `v24.18.0`
- Docker Client: `29.6.1`
- Docker Compose: `v5.2.0`
- RAM: approximately `24 GiB`
- Free disk: approximately `129 GiB`

The official Open supOS deployment documentation and supported deployment targets are Ubuntu Server 24.04 and Windows. macOS is not the currently adopted supported deployment target for this verification.

No sufficiently resourced Ubuntu Server 24.04 host or suitable Windows runtime host was available for this run.

Historical context: a previously identified Linux host was below the official `4c8g` resource profile. It is not the current blocker and no services were stopped to make room.

## 3 Docker Runtime State

The Docker daemon is not available:

```text
unix:///Users/xieweikai/.docker/run/docker.sock
```

The socket does not exist, so:

```text
docker compose ps
```

could not be executed against an official Open supOS runtime.

No Open supOS official service is running.

## 4 Official Runtime Deployment

The official Open supOS runtime was not started.

No official installation command was executed in this run. The deployment repository contains `bin/install.sh`; the English README has historically referenced `bin/startup.sh`, while the Chinese README and actual script inventory agree on `bin/install.sh`.

No upstream source was modified or patched.

## 5 Services

No Open supOS service was started.

The expected upstream service set remains external evidence only:

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

None is claimed as running or healthy.

## 6 MQTT Verification

MQTT listener discovery was not possible without a running official runtime.

The following checks were not executed:

- MQTT connect
- subscribe ACK
- broker probe round trip
- SO-MFG publish through MQTT

No public MQTT broker, independent EMQX instance, in-memory transport, or direct Adapter call was used as a substitute.

## 7 SO-MFG Inbound

No SO-MFG message was published through a real broker.

```text
messagesPublished = 0
messagesIngested = 0
```

The intended verification path remains:

```text
buildSoMfg001UnsMessages()
  -> OpenSupOSMqttTransport
  -> real Open supOS MQTT broker
  -> configured subscriber
  -> OpenSupOSAdapter
  -> fresh SQLite
```

## 8 Fresh DB

No fresh database was rebuilt from MQTT.

Observed counts:

```text
SourceSystems      = 0
Entities           = 0
EntityReferences   = 0
Documents          = 0
Events             = 0
Evidence           = 0
```

The expected verification target remains:

```text
7 / 8 / 8 / 8 / 11 / 11
```

This is an expected target, not a verified result.

## 9 Rule Evaluation

No runtime-rebuilt database was available for rule evaluation.

Observed counts:

```text
Evaluations     = 0
MATCHED         = 0
NOT_MATCHED     = 0
Exceptions      = 0
ResolutionCases = 0
```

The expected future runtime verification target remains:

```text
7 / 4 / 3 / 4
```

This is not a runtime-verified result.

## 10 Duplicate Delivery

A second real MQTT publish batch was not executed.

```text
duplicateBatchStable = false
```

No duplicate-delivery claim is made.

## 11 MES / QMS Lineage

No real runtime ingest occurred, so MES and QMS lineage was not verified.

## 12 UNS Visibility

```text
unsVisibility = "not_verified"
```

No UNS namespace, model, topic, or Source Flow was created.

No automatic or provisioning-required conclusion is claimed without a running runtime.

## 13 OpenAPI Discovery

```text
openApiGateway = "not_verified"
```

No running gateway or backend was available to inspect.

## 14 Known Upstream Issue

The English README has historically referenced `bin/startup.sh`, while the audited repository contains `bin/install.sh`. The Chinese README and actual script inventory agree on `bin/install.sh`.

No upstream patch is required for this evidence refresh:

```text
UPSTREAM_PATCH_REQUIRED = false
```

## 15 Outbound

Open supOS outbound is not enabled.

No Exception or Resolution was automatically published.

Phase 5B2 has not started.

## 16 Truthfulness Boundary

```text
CODE_IMPLEMENTED = true
LOCAL_TESTED = true
REAL_OPEN_SUPOS_RUNTIME_VERIFIED = false
MQTT_RUNTIME_VERIFIED = false
UNS_MODEL_VERIFIED = false
SOURCE_FLOW_VERIFIED = false
OPENAPI_RUNTIME_VERIFIED = false
OUTBOUND_VERIFIED = false
PHASE_5B2_STARTED = false
```

## 17 Current Blocker

```text
OPEN_SUPOS_RUNTIME_BLOCKED: NO_SUPPORTED_RUNTIME_HOST
```

The current macOS host is not the adopted official deployment target, the local Docker daemon is unavailable, and no sufficiently resourced Ubuntu Server 24.04 or suitable Windows runtime host was available for real Open supOS deployment.
