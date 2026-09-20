# Superset Embedded Integration（Feasibility Phase）

## Status

```text
SUPERSET_STACK_LOCAL_STARTED=true
SUPERSET_PROJECTION_LOADED=true
SUPERSET_GUEST_TOKEN_ISSUED=true
SUPERSET_EMBED_IMPLEMENTED=true

SUPERSET_LOCAL_DASHBOARD_VERIFIED=true
SUPERSET_REAL_CUSTOMER_VERIFIED=false
SUPERSET_MULTITENANT_RLS_VERIFIED=false
SUPERSET_PRODUCTION_HA_VERIFIED=false
```

`SUPERSET_LOCAL_DASHBOARD_VERIFIED=true` 的依据是浏览器里真实渲染出 4 个模块
（异常类型分布 / 治理推进 / 规则触发率 / 来源系统分布，含真实数据），
以及 `npm run superset:verify-embed` 的 22 项真实链路检查全部通过；
它只代表本地 pilot 的单租户嵌入成立，不代表生产、多租户 RLS 或客户验收。

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
- 修复后在真实浏览器里打开 `http://127.0.0.1:3411/analytics`：iframe 已挂载，
  Superset dashboard 真实渲染出 4 个模块（异常类型分布 / 治理推进 / 规则触发率 /
  来源系统分布），表格里是真实数据（发货数量短少 10/11、回款余额未结清 7/11 …），
  无 401、无 403、无登录弹窗、无空白看板；截图证据
  `.preview/superset-live/analytics-superset-1440.png`、`analytics-superset-1600.png`
  （四个象限的非白像素占比 7.5%–25%，对比修复前同位置约 1% 的近空白截图）
- `npm run superset:verify-embed` 22/22 PASS；`npm run superset:init-role` 重复执行
  `added=0 removed=0`（幂等）

### 已定位的根因（两个，都是配置/装配问题，不是 SDK 兼容性问题）

**根因 1：`GUEST_ROLE_NAME` 落在默认的 `Public`，而 `Public` 没有任何权限。**

Superset 的 guest 用户角色是唯一授权来源
（`superset/security/manager.py` `get_guest_user_from_token` →
`roles=[find_role(get_conf()["GUEST_ROLE_NAME"])]`），而官方默认值是 `"Public"`；
`superset init` 之后的 `Public` role 在 metadata 里是 **0 条权限**
（`.preview/superset/guest-role-audit.txt` 有完整运行时审计）。因此嵌入应用
启动时的每个 API 调用都 403：

```text
GET /api/v1/me/                  -> 403 {"message":"Forbidden"}
GET /api/v1/me/roles/            -> 403 {"message":"Forbidden"}
GET /api/v1/dashboard/1/charts   -> 403 {"message":"Forbidden"}
```

对照实验（只用于确认根因，不是最终设计）：把 `GUEST_ROLE_NAME` 临时设为 `Gamma`
后，`/api/v1/me/` 与 `/api/v1/me/roles/` 立刻返回 200，`ROOT_CAUSE_CONFIRMED =
guest role permission`。随后按最小权限新建专用 role `EmbeddedGuest`（不是 Gamma、
不是 Admin）。

**根因 2：dashboard 与 chart 的关联从未建立，`dashboard_slices` 是空的。**

权限修好之后 `/api/v1/dashboard/1/charts` 返回 200 但 `result` 为空数组，
看板会是空白。Superset 只在 PUT 的 `json_metadata.positions` 里同步
dashboard ↔ chart 关联（`superset/daos/dashboard.py` `set_dash_metadata` 从 positions
的 `chartId` 反查 Slice 写 `dashboard.slices`）；只写 `position_json` 不会建立关联。

**另外确认的版本事实（不是缺陷，也不需要升级 SDK）。** Superset 6.1 已移除旧的
`bar` viz plugin，旧定义会渲染成 `Item with key "bar" is not registered`；
`/api/v1/dashboard/<uuid>` 只接受 dashboard 自身的 uuid 或数字 id / slug，
**不接受嵌入式 uuid**——嵌入页通过 bootstrap 把数字 dashboard id 交给 SPA
（`superset/embedded/view.py`），所以嵌入应用真正调用的是
`/api/v1/dashboard/<数字 id>/...`。`@superset-ui/embedded-sdk@0.4.0` 与 6.1 服务端
没有发现兼容性问题，本轮**未**升级 SDK、未改 CORS、未关闭 CSRF、未使用
`all_datasource_access`、未使用 Admin 角色。

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
npm run superset:init-role      # 幂等收敛 EmbeddedGuest 的最小权限（含 4 张事实表 datasource_access）
# 业务后端带上 deploy/superset/.env 里的 SUPERSET_* 变量后启动
npm run superset:verify-embed   # 真实链路：health / guest token / me / charts / datasets / chart data / 边界
```

`deploy/superset/.env` 中的 `SUPERSET_GUEST_ROLE_NAME`（默认 `EmbeddedGuest`）决定
guest token 用哪个 role；`docker compose up` 首次初始化时 `init/01-init.sh` 会调用
`init/02-embedded-role.py --allow-missing-datasets` 先把 role 与 4 条只读权限建好，
投影导入并建好 dataset 之后再跑 `npm run superset:init-role` 收敛 dataset 授权。

## EmbeddedGuest 实际权限（8 条，全部只读）

```text
can_read  on CurrentUserRestApi      # /api/v1/me/、/api/v1/me/roles/
can_read  on Dashboard               # /api/v1/dashboard/<id>、/charts、/datasets
can_read  on Chart                   # /api/v1/chart/<id>、POST /api/v1/chart/data
can_read  on Dataset                 # dataset 元数据（受 DatasourceFilter 收窄）
datasource_access on [fep analytics].[fact_exception_type](id:1)
datasource_access on [fep analytics].[fact_resolution_stage](id:2)
datasource_access on [fep analytics].[fact_rule_performance](id:3)
datasource_access on [fep analytics].[fact_source_system](id:4)
```

没有 `all_datasource_access`、没有写权限、没有 SQL Lab、没有 database admin。
非白名单 dashboard / dataset 对 guest 返回 404，写请求在执行前就被拒。

## 测试

- `tests/superset-guest-token.test.ts`：配置完备性、fail-closed、tenant 边界、guest token 铸造
  必须带 session cookie + CSRF、响应无密钥泄漏、上游失败收敛为稳定错误码
- `tests/superset-guest-token-http.test.ts`：真实 HTTP 边界（401 / 403 scope / 403 tenant /
  200 + 无密钥泄漏 + guest token 声明）
- `tests/superset-embedded-config.test.ts`：本次 403 根因的静态回归护栏
  （必须显式设置 `GUEST_ROLE_NAME` 且不退回 Public/Gamma/Admin、compose 注入该变量、
  role 脚本按 permission/view_menu 查找且白名单只含只读权限、
  dashboard 通过 `json_metadata.positions` 关联 chart、不使用被否定的修法）
- `npm run superset:verify-embed`（`scripts/verify-superset-embed.mjs`）：真实链路 22 项检查，
  含 `POST /api/v1/chart/data` 必须返回真实行、错误租户/scope 必须被拒、
  非白名单资源必须拒绝；**不允许**只凭 iframe HTML 200 判 PASS
- `frontend/src/features/analytics/analytics-page.test.tsx`：provider 切换（Superset 嵌入、
  Power BI 回退、都未配置时的「分析服务尚未配置」）
