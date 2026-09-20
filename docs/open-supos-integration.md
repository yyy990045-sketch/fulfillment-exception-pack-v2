# open supOS Real Runtime Integration & Verification

本轮基线：`0f56c6d97e7c7b734e2910ff8d60dc3c32121e2d`
目标：把 open supOS → Source Flow / MQTT / UNS → Inbound Connector → Context / Evidence /
Rule / Exception 这条链路**真实**跑通并留下证据。

本轮结论：**`BLOCKED_BY_HOST`**。open supOS 官方运行时没有在本机启动，
因此所有运行时真值保持 false。下面是证据、代码现状、以及解除阻塞所需的最小环境。

---

## 1. Truth flags（只有真实跑通才能为 true）

```text
OPEN_SUPOS_RUNTIME_IMPLEMENTED       = true   # 适配层/映射/校验/验证 harness 已实现并有测试
OPEN_SUPOS_RUNTIME_VERIFIED          = false  # 官方运行时未在本机启动
OPEN_SUPOS_MQTT_VERIFIED             = false  # 未连接过真实 open supOS EMQX
OPEN_SUPOS_UNS_VERIFIED              = false  # 未在真实 UNS 中写入并查询到数据
OPEN_SUPOS_CONNECTOR_VERIFIED        = false  # 未收到真实运行时消息
OPEN_SUPOS_EXCEPTION_FLOW_VERIFIED   = false  # 未由真实消息驱动出异常
OPEN_SUPOS_SUPERSET_FLOW_VERIFIED    = false  # 未观测到真实数据进入 Superset 投影

OPEN_SUPOS_REAL_FACTORY_VERIFIED     = false  # 不自动升级
OPEN_SUPOS_REAL_CUSTOMER_VERIFIED    = false  # 不自动升级
OPEN_SUPOS_PRODUCTION_VERIFIED       = false  # 不自动升级

OPEN_SUPOS_RUNTIME_BLOCKED           = BLOCKED_BY_HOST
```

**边界**：即使本机能跑通官方运行时，那也只是「真实 open supOS runtime」，
**不等于**「真实工厂数据 / 真实客户 / 生产环境」。上面三个 `REAL_*` 永远不由本地验证升级。

---

## 2. 现有代码审计（不重复造已有能力）

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| UNS 信封契约 `OpenSupOSUnsEnvelope` | IMPLEMENTED + LOCALLY_VERIFIED | `src/integrations/open-supos/types.ts`、`envelope.ts`（schemaVersion/tenantKey/context/source/entity/event/facts/lineage/metadata 全量校验） |
| UNS topic 编解码 | IMPLEMENTED + LOCALLY_VERIFIED | `src/integrations/open-supos/topic-mapper.ts`，`fulfillment/{tenant}/{context}/{entityType}/{entityKey}/{eventType}`，通配 `fulfillment/+/+/+/+/+` |
| MQTT transport | IMPLEMENTED + LOCALLY_VERIFIED（逻辑层） | `transport.ts`（`OpenSupOSMqttTransport` + `InMemoryUnsTransport`），真机连接为 BLOCKED |
| 信封 → 领域写计划映射 | IMPLEMENTED + LOCALLY_VERIFIED | `mapper.ts`、`domain-plan.ts` |
| 幂等摄入 | IMPLEMENTED + LOCALLY_VERIFIED | `adapter.ts` 用 `getEventByIdempotency` 判定 `duplicated` 后 `applyDomainWritePlan` |
| SO-MFG-001 真实数据面（11 条 UNS 消息） | IMPLEMENTED + LOCALLY_VERIFIED | `manifests/so-mfg-001.ts`；`tests/open-supos-superseding.test.ts` 断言 7 源系统 / 8 实体 / 8 引用 / 8 文档 / 11 事件 / 11 证据 |
| 运行时验收 harness | IMPLEMENTED + LOCALLY_VERIFIED | `runtime-verify.ts`（真实 MQTT、fresh DB、重放稳定、规则期望值 fail-closed） |
| 运行时验收闸门 `npm run open-supos:verify` | IMPLEMENTED（本轮新增，fail-closed） | `verify-cli.ts` + `tests/open-supos-verify-gate.test.ts` |
| 出站（异常/治理结果回写 open supOS） | IMPLEMENTED（未启用） | `outbound.ts`、`mapExceptionToUnsMessage`；本轮不启用 |
| **官方 open supOS runtime** | **BLOCKED** | 见第 3 节 |
| **UNS 在平台侧的真实可见性** | **BLOCKED** | 需要运行中的 open supOS 才能查询 |
| **`OpenSuposInboundConnector`（接 Connector Core 的 SourceRecordEnvelope / cursor / sync-run）** | **MISSING** | 当前 MQTT 是 push 路径，直接 `adapter.ingest`，**没有**经过 `src/connectors/core` 的 `InboundConnector.readPage` / `SourceRecordEnvelope` / cursor ledger。这是结构性缺口，见第 6 节 |
| **「正常数据不产生异常」独立用例（A/B）** | **MISSING** | 现有 manifest 是固定混合结果（7 次评估 / 4 命中 / 3 未命中 / 4 异常），没有单独一组「全一致 → 0 异常」的用例 |
| **真实运行时故障注入（断 broker / 畸形 payload / 下游失败）** | **PARTIAL** | 单测覆盖了 provenance 不符、公共 broker 拒绝、clientId 冲突、信封非法、版本演进；未在真实运行时上做过故障注入 |

`npm run open-supos:inbound` 与 `npm run open-supos:verify:mqtt` 都是既有入口，未被本轮替换。

---

## 3. 为什么本机 BLOCKED_BY_HOST（四条独立阻塞）

完整原始记录：`.preview/open-supos/runtime-status.txt`（本地证据，不提交）。

**A. 架构**：官方 `eco-registry.supos.com/sup9bnlh/*` 全部镜像（backend / node-red / emqx /
grafana / portainer-ce / timescaledb / keycloak / minio / chat2db / pi-agent）经
`docker manifest inspect --verbose` 确认都是**单架构 `linux/amd64`**，没有 manifest list，
官方不存在 arm64 路径。

**B. 平台**：官方 README 的支持环境是 Ubuntu Server 24.04（Linux）与 Windows + Docker Desktop；
macOS 不在支持矩阵内。官方 `bin/install.sh` 第 10 行用 GNU `sed -i 's/\r$//'`，本机实测
`sed: 1: "sedtest.txt": unescaped newline inside substitute pattern`（exit 1），
后续还会 source `bin/deb/install-docker*.sh` 的 Debian/openEuler 路径。
官方 `.env` 也明确要求 `ENTRANCE_DOMAIN` 不能是 `127.0.0.1`/`localhost`（否则登录与鉴权不工作）。

**C. 部署产物获取**：`git clone`（完整 pack）`curl 18 / early EOF`；
`git clone --filter=blob:none --sparse` 能取到 HEAD 但拉 `mount/` blobs 同样 `early EOF`；
仓库 archive `master.tar.gz` 到约 4.0 MB 断流；单个必需文件
`mount/grafana/data/plugins/grafana-mqtt-datasource.tar.gz`（8.45 MB）三次尝试（含续传）
最大只收到 3.2 MB，其中两次 `SSL_ERROR_SYSCALL`。没有 `mount/`（约 78 MiB）就无法准备官方
volumes，官方服务无法启动。

**D. 资源**：官方最低档就是 `docker-compose-4c8g.yml`（4C/8G，14 个服务，含 backend、
Keycloak、TimescaleDB ×2、EMQX、Node-RED、Grafana、Chat2DB、pi-agent）。本机 Docker VM
只有 8.31 GiB，且全部要在 amd64 模拟下运行。

补充事实：本机 Docker 已可用（29.6.1，`linux/aarch64`，10C/8.31 GiB），
`docker run --platform linux/amd64 alpine:3.20 uname -m` 返回 `x86_64`，即 **Rosetta 模拟可用**。
也就是说「架构不可执行」不是本机的问题，问题在于官方不支持 + 产物拿不到 + 资源边际。

本轮**没有**做的（避免误读）：没有启动任何 open supOS 服务；没有 patch/重打包/替换官方镜像；
没有向任何公共 broker 发布数据；没有用内存 transport 或直接写库来「演示通过」。

---

## 4. 官方运行时事实（只读审计）

```text
repository   = https://gitee.com/supos-community-edition/supos-ce-deploy.git
branch       = master
commit       = 9272ef5f124f317f902a7a6d2302a22a8c2467e3   (2026-09-14)
OS_VERSION   = V1.5.0.0-M
入口脚本      = bin/install.sh（README 里写 bin/startup.sh，已知上游文档不一致）
```

核心组件与端口（来自官方 4c8g compose）：

```text
nginx/openresty   gateway           ENTRANCE_PORT=8088 / 8443
emqx              MQTT broker       1883 / 8883 / 8083 / 8084 / 18083(dashboard)
nodered           Source Flow       1880
keycloak          SSO / 鉴权         8081
postgresql        metadata DB       5432
tsdb (timescaledb) time-series      2345
minio             object storage    9000 / 9001      (profile: minio)
grafana           dashboards        3000             (profile: grafana，默认启用)
portainer         container UI      8000 / 9443
chat2db / pi-coding-agent / plugin_front / backend(应用服务)
```

---

## 5. 计划中的真实链路（契约，待运行时验证）

### 5.1 最小 UNS 模型

对象取现有 Manufacturing Pack 已经在用的 `sales_order` 语境（`SO-MFG-001`），
事件面覆盖订单/生产/质检/发运/应收/回款/客诉，字段可直接进 Business Context / Rule Engine：

```text
context.businessKey  = SO-MFG-001          (contextType = sales_order)
entity.entityType    ∈ {quote, contract, sales_order, production_order,
                        quality_event, shipment, receivable, payment, complaint}
facts.*              = 数值/金额/声明量，例：plannedQty / completedQty / passedQty / failedQty / qty / amount
```

### 5.2 MQTT / UNS topic

```text
fulfillment/{tenantKey}/{contextBusinessKey}/{entityType}/{entityBusinessKey}/{eventType}
订阅通配              fulfillment/+/+/+/+/+
示例                  fulfillment/demo-manufacturing/SO-MFG-001/production_order/MO-MFG-001/PRODUCTION_COMPLETED
```

### 5.3 Connector 映射（当前实现）

```text
MQTT payload (OpenSupOSUnsEnvelope, schemaVersion=1.0)
  → parseOpenSupOSUnsEnvelope   (schema/枚举/时间戳/置信度全量校验)
  → parseUnsTopic + topic↔envelope 一致性校验
  → mapUnsEnvelopeToDomainPlan  (context / sourceSystem / entity / entityReference / sourceDocument / event / evidence)
  → applyDomainWritePlan        (幂等键命中则不去重写，只回报 duplicated=true)
```

provenance 事实：`source.systemKey` / `systemType` / `externalDocumentId` / `documentType` /
`sourceVersion` 与 `event.occurredAt` 全部落到 `SourceDocument` + `FulfillmentEvent` + `V2Evidence`，
`Evidence.sourceSystemId` 可回溯到具体源系统（`tests/open-supos-superseding.test.ts` 有 lineage 断言）。

**与 Connector Core 的差异（必须显式记录）**：Connector Core 的
`SourceRecordEnvelope` 还带 `connectorId` / `connectorInstallationId` / `rawHash` /
`mappingId` / `mappingVersion` / `locator`，并配合 `InboundConnector.readPage` 的
cursor + `ConnectorSyncRun` 账本。open supOS 的 MQTT 是 push 模型，当前**没有**产生
`SourceRecordEnvelope`，也没有 cursor/offset —— 幂等只靠 `idempotencyKey`。
要满足「Core runtime 不感知 open supOS 特有字段 + 复用 Source Ledger / cursor / replay」，
需要补一个薄的 `OpenSuposInboundConnector`：把每条 MQTT 消息映射成 `SourceRecordEnvelope`
（`locator` 记录 namespace/topic/entity，`rawHash` 记录 payload 摘要，`mappingId/mappingVersion`
记录映射版本），再交给既有 Connector Core 路径。本轮**未**实现。

### 5.4 验证流程

```bash
# 1. 指向真实运行时（地址来自真实部署，不写死）
set -a; . ./.env.open-supos.local; set +a
# 2. 真实链路验收（fail-closed：缺任何证据都不会 PASS）
npm run open-supos:verify
# 3. 只看 MQTT/领域/规则那一段（既有 harness）
npm run open-supos:verify:mqtt
# 4. 分析投影（真实数据进 Superset 链路）
npm run superset:export
docker compose -f deploy/superset/docker-compose.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -U superset -d analytics < .preview/superset/projection.sql
npm run superset:verify-embed
```

`npm run open-supos:verify` 固定输出 12 项检查（每项 PASS / FAIL / BLOCKED）：

```text
runtime.health            open supOS 网关健康
runtime.components        gateway / emqx / nodered / keycloak / db / tsdb / minio 健康
mqtt.publish              broker 往返 + 11 条消息发布
mqtt.subscribe            连接 + 订阅 ACK
connector.ingest          11/11 条消息被适配层接收
domain.commit             context/entity/event/evidence 落库（11 events / 11 evidence）
rule.evaluated            7 次规则评估（4 命中 / 3 未命中）
exception.created         产生 4 个异常
replay.idempotent         第二批重放后计数不变
runtime.real_transport    必须是真的 MQTT transport（注入式 transport 直接 FAIL）
uns.data_exists           UNS 侧能查询到这批 messageId
analytics.projection      投影里能看到这批异常
```

任何一项缺失 → 整体 `BLOCKED` 或 `FAIL` 且退出码非 0；缺证据时**不会**输出 PASS。
`OPEN_SUPOS_ENABLED != true`、未配置运行时健康地址、未配置 UNS 查询入口时，
检查项仍然全部列出并标记 BLOCKED。

---

## 6. 失败场景与处理（设计约定）

| 场景 | 期望行为 | 当前覆盖 |
| --- | --- | --- |
| open supOS / 网关不可达 | `runtime.health` FAIL，整体不 PASS，不尝试降级 | 闸门已实现 |
| MQTT broker 不可用 | 连接超时 → `UNS_TRANSPORT_CONNECTION_FAILED/TIMEOUT`，不发第二批 | `transport.ts` + harness |
| 上游 commit 与审计值不符 | `OPEN_SUPOS_UPSTREAM_COMMIT_MISMATCH` 直接拒绝 | 单测覆盖 |
| 指向公共 broker | `OPEN_SUPOS_PUBLIC_BROKER_REJECTED` | 单测覆盖 |
| payload 非法 / topic 与信封不一致 | `INVALID_UNS_ENVELOPE` / `INVALID_UNS_TOPIC`，不落库 | 单测覆盖 |
| mapping 拒绝（schemaVersion 不支持） | `DOMAIN_UNS_SCHEMA_VERSION_UNSUPPORTED` | 单测覆盖 |
| 下游失败 | 由调用方决定重放；幂等键保证不会重复写入 | 部分覆盖（真实运行时故障注入未做） |
| 重复投递 | 计数不变化、`duplicated=true` | harness `duplicateBatchStable` |
| cursor | MQTT push 路径没有 cursor；pull 连接器才有 cursor 语义 | **GAP**（见 5.3） |

---

## 7. 安全边界

- 运行时地址/账号只进 `.env.open-supos.local`（已 gitignore），仓库里只有 `.env.open-supos.example` 变量名
- 闸门与 harness 只回显脱敏后的 endpoint（`redactMqttUrl` 去掉 userinfo/query）
- 不输出密码、MQTT credential、Keycloak secret、SUPOS_API_KEY、完整 guest token/JWT
- 不把平台源码复制进本项目；官方仓库只在项目外做只读审计

---

## 8. 解除阻塞所需的最小可行运行环境

任选其一，**必须是 x86_64（amd64）**，因为官方只发 amd64 镜像：

**方案 1（首选，官方支持目标）**

```text
OS       : Ubuntu Server 24.04 x86_64（官方 tested 环境）
Docker   : Engine 27.4.0 + Compose v2.31.0 + Buildx v0.19.2 + containerd 1.7.24（官方 tested 版本组）
资源     : ≥4 vCPU / ≥8 GiB RAM（建议 8C/16G，用 docker-compose-8c16g.yml），磁盘 ≥60 GiB
网络     : 能稳定访问 gitee.com（拉 deploy 仓库，约 431 MiB）与 eco-registry.supos.com（镜像约 2 GiB）
步骤     : git clone deploy 仓库 → 改 .env（VOLUMES_PATH、ENTRANCE_DOMAIN=该机内网 IP，不能用 127.0.0.1）
           → bash bin/install.sh → 等容器 healthy
```

**方案 2（Apple Silicon 本机就近）**

```text
在 macOS 上起一台 x86_64 Linux 虚拟机（UTM / Lima / 云主机均可；arm64 镜像不行）
用 amd64 Ubuntu Server 24.04 镜像，给 4 vCPU / 8 GiB / 60 GiB
其余同上；宿主机通过 VM 的 IP 访问 8088 网关
```

拿到运行中的运行时之后，把以下值写进 `.env.open-supos.local` 再跑 `npm run open-supos:verify`：

```text
OPEN_SUPOS_MQTT_URL=mqtt://<user>:<pass>@<runtime-host>:1883
OPEN_SUPOS_RUNTIME_HEALTH_URL=http://<runtime-host>:8088/health
OPEN_SUPOS_COMPONENT_HEALTH=gateway=http://<runtime-host>:8088/health,emqx=http://<runtime-host>:18083/status,...
OPEN_SUPOS_UNS_VERIFY_URL=http://<runtime-host>:8088/<UNS 查询入口>
OPEN_SUPOS_UPSTREAM_COMMIT=9272ef5f124f317f902a7a6d2302a22a8c2467e3
OPEN_SUPOS_RUNTIME_CONFIRMED=true
```

---

## 9. 本轮未做的事

没有新比赛适配、没有 capability map、没有大改 UI、没有新增 AI Agent、没有动 Jev /
Decision / Governance、没有重构 Connector Core、没有新增 Power BI、没有重构 Superset、
没有为了演示伪造 open supOS。
