# open supOS 远程真实运行时验收 Runbook

目标：拿到一台**全新的 Ubuntu 24.04 x86_64** 主机后，另一名工程师只看这份文档即可完成
open supOS 真实运行时验收，并把 truth flag 升级到 live 状态。

前提：本机（macOS arm64）**不能**作为运行时宿主机——官方镜像全部是 `linux/amd64`，
官方支持矩阵是 Ubuntu 24.04 / Windows。本地只能做到 `LOCAL_CONTRACT_VERIFIED`。

---

## 0. 一句话流程

```text
host preparation → official deploy fetch → config → runtime startup → health
→ MQTT → UNS → FEP backend → A/B events → replay → analytics → Superset → truth flag update
```

---

## 1. Host preparation

```bash
# Ubuntu 24.04 x86_64；≥4 vCPU / ≥8 GiB RAM（推荐 8C16G）/ ≥60 GiB 可用磁盘
uname -m                                  # 必须是 x86_64
. /etc/os-release && echo "$ID $VERSION_ID"   # 必须是 ubuntu 24.04
docker version && docker compose version && docker buildx version
```

在本项目里跑只读预检（不安装、不修改任何东西）：

```bash
cd <fulfillment-exception-pack>
scripts/open-supos-remote-preflight.sh
```

输出 `PREFLIGHT: PASS` 才继续；输出 `PREFLIGHT: BLOCKED_BY_HOST` 时**不要**继续安装，
也不要声称验证通过（脚本以非 0 退出）。

---

## 2. official deploy fetch

```bash
scripts/open-supos-remote-bootstrap.sh /opt/supos-ce-deploy
```

它会：跑 preflight → 从官方仓库 `gitee.com/supos-community-edition/supos-ce-deploy`
以 `--depth 1` 克隆 → 记录 `repo URL / commit SHA / OS_VERSION` →
校验 `bin/install.sh`、`docker-compose-4c8g.yml`、`docker-compose-8c16g.yml`、`mount/`、`.env` 是否齐全。

provenance 写到 FEP 侧的 `.preview/open-supos-live/bootstrap-provenance.json`，
**不修改官方仓库内容**。任何一步不满足就 `BOOTSTRAP: FAIL` 并停止。

固定记录（写进最后的 evidence manifest）：

```text
repoUrl    = https://gitee.com/supos-community-edition/supos-ce-deploy.git
commit     = <bootstrap 输出的 commit>
osVersion  = <.env 里的 OS_VERSION>
```

---

## 3. config

```bash
cd /opt/supos-ce-deploy
vi .env
```

必须改：

```text
VOLUMES_PATH     = /opt/supos/volumes      # 宿主机数据目录
ENTRANCE_DOMAIN  = <本机内网/Tailnet IP>   # 不能用 127.0.0.1 / localhost，否则登录与鉴权不工作
ENTRANCE_PORT    = 8088
OS_RESOURCE_SPEC = 1                       # 1 = 4c8g，2 = 8c16g
```

同时在 FEP 项目侧准备验收配置（真实值不提交）：

```bash
cd <fulfillment-exception-pack>
cp deploy/open-supos/.env.remote.example deploy/open-supos/.env.remote
# 填 OPEN_SUPOS_BASE_URL / MQTT / UNS / FEP / SUPERSET 各项；.env.remote 已被 gitignore
```

---

## 4. runtime startup

```bash
cd /opt/supos-ce-deploy && bash bin/install.sh
```

官方脚本会启动官方 compose（默认 profile 含 grafana；minio / pi-agent 可选）。
首次会拉取官方镜像（约 2 GB）并初始化 volumes。

---

## 5. health

```bash
curl -fsS "http://<ENTRANCE_DOMAIN>:8088/health"
docker compose -f /opt/supos-ce-deploy/docker-compose-4c8g.yml ps
```

至少确认：gateway/nginx、keycloak、emqx、nodered、postgresql、tsdb 处于 healthy/running，
EMQX Dashboard `http://<ENTRANCE_DOMAIN>:18083`、Node-RED `http://<ENTRANCE_DOMAIN>:1880` 可打开。

把结果填进 `deploy/open-supos/.env.remote`：

```text
OPEN_SUPOS_RUNTIME_HEALTH_URL=http://<ENTRANCE_DOMAIN>:8088/health
OPEN_SUPOS_COMPONENT_HEALTH=gateway=http://<ENTRANCE_DOMAIN>:8088/health,emqx=http://<ENTRANCE_DOMAIN>:18083/status
```

---

## 6. MQTT

```bash
# 用官方 supOS 平台里的账号/凭据（不要写进仓库）
# EMQX 默认 1883；若开启鉴权，使用平台下发的 MQTT 账号
mosquitto_sub -h <ENTRANCE_DOMAIN> -p 1883 -t 'fulfillment/#' -v
```

填入：

```text
OPEN_SUPOS_MQTT_HOST=<ENTRANCE_DOMAIN>
OPEN_SUPOS_MQTT_PORT=1883
OPEN_SUPOS_MQTT_USERNAME=
OPEN_SUPOS_MQTT_PASSWORD=
OPEN_SUPOS_TOPIC_PREFIX=fulfillment
```

---

## 7. UNS

在 open supOS 平台里建立/确认最小 UNS 模型（对象与事件），并用平台自身的查询入口确认
`fulfillment/<tenant>/<context>/<entityType>/<entityKey>/<eventType>` 这类 topic 下的数据可见。

```text
OPEN_SUPOS_UNS_NAMESPACE=fulfillment/<tenant>
OPEN_SUPOS_UNS_VERIFY_URL=<平台侧可查询该 namespace 数据的 HTTP 入口>
```

没有这个证据，第 05 步 `uns.object_exists` 会 BLOCKED，整体不会 VERIFIED。

---

## 8. FEP backend

```bash
cd <fulfillment-exception-pack>
npm ci
# 业务后端要能读到 deploy/open-supos/.env.remote 里的 OPEN_SUPOS_* 与业务库配置
PACK_STORE_DIR=<业务库目录> PACK_STORE_DB=<业务库 sqlite> npm run demo
```

确认 `http://<FEP_BASE_URL>/api/health` 返回 200，`/analytics` 能打开现有页面。

---

## 9. A/B events

两个 case 都由统一入口摄入，结构完全一致，只有数值不同：

```text
Case A normal-order     SO-AB-N-001   计划/订单/生产完成/质检/发货/回款/客户声明 全部一致
Case B exception-order  SO-AB-X-001   仅生产完成数量 96 < 订单数量 100
```

```bash
cd <fulfillment-exception-pack>
npm run open-supos:verify -- --mode live     # 01-18 步证据（含 A/B / replay / ledger / cursor / 投影导出）
```

---

## 10. replay

第 14-15 步由同一次 live 运行覆盖：把 Case B 的消息在真实 broker 上重投一次，
断言 `new ledger = 0 / new business event = 0 / new exception = 0`，异常总数不变；
第 17 步用已提交 checkpoint 再跑一次，断言 `recordsRead = 0`。

---

## 11. analytics

```bash
npm run superset:export                     # 生成 .preview/superset/projection.sql
```

---

## 12. Superset

```bash
docker compose -f deploy/superset/docker-compose.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -U superset -d analytics < .preview/superset/projection.sql
npm run superset:verify-embed               # 22 项真实链路检查
```

以上两步也可以直接交给编排脚本（它会自动重载、验证并写 receipt）：

```bash
scripts/open-supos-remote-verify.sh deploy/open-supos/.env.remote
```

脚本固定按 20 步输出 PASS/FAIL，最后只有 20/20 才打印 `REMOTE_RUNTIME_VERIFIED`；
任何一步没有证据都是 FAIL。证据清单写到 `.preview/open-supos-live/evidence.json`（不提交）。

---

## 13. truth flag update

只有 `scripts/open-supos-remote-verify.sh` 输出 `REMOTE_RUNTIME_VERIFIED（20/20）` 之后，
才允许在 `docs/open-supos-integration.md` 里改为：

```text
OPEN_SUPOS_RUNTIME_VERIFIED        = true
OPEN_SUPOS_MQTT_VERIFIED           = true
OPEN_SUPOS_UNS_VERIFIED            = true
OPEN_SUPOS_CONNECTOR_VERIFIED      = true
OPEN_SUPOS_EXCEPTION_FLOW_VERIFIED = true
OPEN_SUPOS_SUPERSET_FLOW_VERIFIED  = true
```

永远保持 false（本地/远程运行时都不构成客户与生产证据）：

```text
OPEN_SUPOS_REAL_FACTORY_VERIFIED   = false
OPEN_SUPOS_REAL_CUSTOMER_VERIFIED  = false
OPEN_SUPOS_PRODUCTION_VERIFIED     = false
```

---

## 14. 常见阻塞与判定

| 现象 | 判定 |
| --- | --- |
| `uname -m` 不是 x86_64 | `BLOCKED_BY_HOST`：官方无 arm64 镜像 |
| OS 不是 Ubuntu 24.04 | `BLOCKED_BY_HOST`：非官方 tested 目标 |
| docker/compose/buildx 缺失或 daemon 未运行 | `BLOCKED_BY_HOST` |
| gitee / eco-registry 不可达 | `BLOCKED_BY_HOST`：拿不到官方产物 |
| `ENTRANCE_DOMAIN=127.0.0.1` | 失败：官方明确要求非回环地址，否则登录/鉴权不工作 |
| 第 05 步 UNS 无证据 | `FAIL`：不能只凭 MQTT 收到消息就宣称 UNS 成立 |
| 第 19-20 步没有 receipt | `BLOCKED`：Superset 侧必须真实重载并真实渲染 |

**纪律**：不允许魔改官方镜像、不允许 patch 官方源码、不允许用注入式 transport 或内存 broker
冒充真实运行时；本地 contract 通过只能写 `LOCAL_CONTRACT_VERIFIED`。
