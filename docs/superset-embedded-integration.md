# Superset Embedded Integration（Feasibility Phase）

## Status

```text
SUPERSET_STACK_LOCAL_STARTED=true
SUPERSET_PROJECTION_LOADED=true
SUPERSET_GUEST_TOKEN_ISSUED=true
SUPERSET_EMBED_IMPLEMENTED=true

SUPERSET_LOCAL_DASHBOARD_VERIFIED=false
SUPERSET_REAL_CUSTOMER_VERIFIED=false
SUPERSET_MULTITENANT_RLS_VERIFIED=false
SUPERSET_PRODUCTION_HA_VERIFIED=false
```

本阶段目标是用开源、自托管的 Apache Superset 承担 Analytics / BI 可视化层，
同时把 Power BI 保留为可选企业 Connector（Power BI 侧状态不变，仍是
`POWERBI_REAL_REPORT_VERIFIED=false` / `BLOCKED_BY_CONFIGURATION`）。

## Feasibility（只依据 Apache 官方文档/仓库）

| 项目 | 结论 | 出处 |
| --- | --- | --- |
| License | Apache License 2.0 | 仓库 `LICENSE.txt` |
| 部署方式 | 官方 Docker Compose（单机）；官方明确不支持生产/高可用，单机生产建议 Kubernetes | `docs/admin_docs/installation/docker-compose.mdx` |
| 组件 | application + metadata DB + cache + worker/beat | `docs/admin_docs/installation/architecture.mdx` |
| Embedded Dashboard | 官方支持；SDK 包 `@superset-ui/embedded-sdk`，`embedDashboard({id, supersetDomain, mountPoint, fetchGuestToken, dashboardUiConfig})` | `docs/docs/using-superset/embedding.mdx` |
| Guest Token | `POST /api/v1/security/guest_token/`，必须由宿主后端用服务账号换取，禁止浏览器直连；默认 300s 过期 | 同上 + `superset/config.py` |
| Row Level Security | Security → Row Level Security，按 dataset + subject 绑定 clause | `docs/admin_docs/security/security.mdx` |
| Dashboard filter | 原生过滤器 + 嵌入态可用 `standalone/show_filters/expand_filters` URL 参数控制 | `docs/docs/using-superset/embedding.mdx` |
| 数据源 | PostgreSQL / MySQL 等数十种（`superset/db_engine_specs/` 内含 postgres.py、mysql.py 等；SQLite 也有 engine spec，但官方把 SQLite 定位为 metadata 库的开发用法，生产 metadata 推荐 Postgres/MySQL） | 仓库源码 + FAQ |
| 生产要求 | HTTPS 反代、独立 metadata 库、`SUPERSET_SECRET_KEY` 独立且不入库、服务端 session、IdP、Talisman | `docs/admin_docs/security/securing_superset.mdx` |
| 版本 | 固定 `apache/superset:6.1.0`（多架构 amd64/arm64） | Docker Hub 官方镜像 |

结论：**适合**替代当前商业 Power BI 作为自托管分析层；但官方 compose 只能用于本地/内网 pilot，
生产需按官方文档换成 Kubernetes 或受管部署，并补齐 HTTPS、独立 metadata、HA 与 IdP。

## 边界

业务系统继续负责 Context / Exception / Evidence / Policy / Governance / Execution / Outcome；
Superset 只负责 Analytics / BI 可视化，不介入业务 workflow。

```text
Application DB / Analytics Projection
  -> analytics 库（4 张事实表）
  -> Superset datasource -> dataset -> dashboard
  -> 后端 /api/v2/analytics/superset/guest-token（scope + 租户校验后签发）
  -> 前端 @superset-ui/embedded-sdk 嵌入
```

前端路由仍是 `/analytics`，用户不跳出当前系统。

## Provider 切换

`/analytics` 通过 `GET /api/v2/analytics/providers` 决定渲染：

```text
defaultProvider = superset（已配置） | powerbi（已配置但未配 Superset） | null
null -> 页面显示「分析服务尚未配置」
```

不引入插件框架：只有 `superset` / `powerbi` 两个 provider，默认优先 Superset。

## 安全边界

- guest token 只能由后端调用 Superset 换取；浏览器只拿到
  `dashboardId / supersetDomain / guestToken / expiresInSeconds`
- 浏览器不保存 Superset 管理员密码、服务账号 secret、JWT 签名密钥
- 接口顺序：`authenticate` → `assertScope("analytics:read")` → 产品租户边界 → 才访问 Superset
- 未配置 → `503 SUPERSET_NOT_CONFIGURED`；租户不匹配 → `403 SUPERSET_TENANT_FORBIDDEN`；
  上游失败统一收敛为 `502 SUPERSET_GUEST_TOKEN_FAILED`，不回显上游细节
- 本轮只支持 single tenant pilot：投影按单租户导出，guest token 的 `rls_rules` 为空，
  **不声明多租户 RLS 已完成**

## 本地验证记录

已通过：

- `docker compose up -d --build` 起来（postgres healthy / superset-init 成功退出 / superset 200）
- 首次初始化自动创建 `analytics` 库与 4 张事实表；真实业务数据导入成功
  （6 类异常 / 9 个治理阶段 / 7 条规则 / 12 个来源系统 / 36 个异常）
- 用官方 REST API 建好 datasource、4 个 dataset、4 个图表、1 个 dashboard，并开启嵌入
- 后端 guest token 接口：未登录 401、缺 scope 403、错误租户 403、正确租户 200
  （返回真实 Superset 签发的 JWT，TTL 300s），响应不含服务账号密码/管理员 token/CSRF token
- 嵌入页面对白名单 Referer 返回 200；不带 Referer 返回 403（白名单校验生效）

未通过（blocker）：iframe 已挂载且嵌入页 200，但嵌入应用对 Superset API 的调用一律 403：

```text
GET /api/v1/me/roles/          -> 403 {"message":"Forbidden"}
GET /api/v1/dashboard/1/charts -> 403
GET /api/v1/me/                 -> 403
```

已排除：`aud` 与 `GUEST_TOKEN_JWT_AUDIENCE` 一致；Referer 在白名单内；资源引用
（数字 dashboard id 与嵌入 UUID 两种都试过）；携带嵌入页下发的 session cookie 与 Origin；
`GUEST_TOKEN_HEADER_NAME`/`GUEST_TOKEN_JWT_ALGO`/非默认 `GUEST_TOKEN_JWT_SECRET` 均已确认生效。
Superset 未输出 `Invalid guest token` 警告，说明 token 解析路径未被判为无效，
下一步需要对照 Superset 官方 compose 的完整装配，确认 6.1 服务端与
`@superset-ui/embedded-sdk@0.4.0` 的握手/会话建立方式是否匹配（升级 SDK 或改用官方
`docker-compose-non-dev.yml` + 其 `docker/` 目录进行对照实验）。

因此本轮**不**声明：

- 已生产部署
- 已完成 RLS
- 已完成多租户 Power BI / Superset 隔离
- 已验证生产容量或 HA

## 复现命令

```bash
cd deploy/superset && cp .env.example .env   # 填随机值后
docker compose up -d --build
PACK_STORE_DIR=<业务库目录> npm run superset:export
docker compose -f deploy/superset/docker-compose.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -U superset -d analytics < .preview/superset/projection.sql
node scripts/superset-setup.mjs
```

## 测试

- `tests/superset-guest-token.test.ts`：配置完备性、fail-closed、tenant 边界、guest token 铸造
  必须带 session cookie + CSRF、响应无密钥泄漏、上游失败收敛为稳定错误码
- `tests/superset-guest-token-http.test.ts`：真实 HTTP 边界（401 / 403 scope / 403 tenant /
  200 + 无密钥泄漏 + guest token 声明）
- `frontend/src/features/analytics/analytics-page.test.tsx`：provider 切换（Superset 嵌入、
  Power BI 回退、都未配置时的「分析服务尚未配置」）
