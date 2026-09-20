# 自托管 Apache Superset（单机 pilot）

用开源、自托管的 Superset 承担 Analytics / BI 可视化层；业务系统仍然自己负责
Context / Exception / Evidence / Policy / Governance / Execution / Outcome。
Power BI integration 保留为可选企业 Connector，不再作为默认 provider。

## 官方依据（只引用 Apache 官方文档/仓库）

- License：Apache License 2.0（仓库 `LICENSE.txt`）
- 部署方式与限制：`docs/admin_docs/installation/docker-compose.mdx`
  —— 官方明确 docker compose 面向单机、**不支持生产与高可用**，单机生产建议 Kubernetes/minikube
- 组件构成：`docs/admin_docs/installation/architecture.mdx`
  —— application + metadata database + cache + worker/beat（compose 会一并创建）
- 嵌入与 guest token：`docs/docs/using-superset/embedding.mdx`
  —— SDK 包名 `@superset-ui/embedded-sdk`；guest token 必须由宿主后端调用
  `POST /api/v1/security/guest_token/` 换取；`EMBEDDED_SUPERSET` 特性开关必须开启；
  allowed domains 按 dashboard 配置
- RLS：`docs/admin_docs/security/security.mdx`（Security → Row Level Security，按 dataset + subject 绑定）
- 生产加固：`docs/admin_docs/security/securing_superset.mdx`（HTTPS 反代、`SUPERSET_SECRET_KEY` 管理、
  服务端 session、IdP、Talisman 等）

## 目录内容

```
deploy/superset/
├── Dockerfile               # 固定发布版镜像 + 补 psycopg2（官方发布镜像不带该驱动）
├── docker-compose.yml       # postgres:17 + redis:7 + superset(6.1.0)
├── superset_config.py       # 全部密钥来自环境变量；启用 EMBEDDED_SUPERSET
├── .env.example             # 复制为 .env 后填本机值（.env 已被 .gitignore 忽略）
├── init/01-init.sh          # 幂等初始化：db upgrade + create-admin + superset init
└── analytics/01-analytics-schema.sql  # analytics 库与 4 张事实表（首次初始化自动执行）
```

## 启动

```bash
cd deploy/superset
cp .env.example .env
# 生成随机值（每个环境独立，禁止复用）：openssl rand -hex 32
#   POSTGRES_PASSWORD / SUPERSET_SECRET_KEY / GUEST_TOKEN_JWT_SECRET / SUPERSET_ADMIN_PASSWORD
docker compose up -d --build
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/health   # 期望 200
```

## 数据源与投影

Analytics 数据不进核心业务库，而是单独的 `analytics` 库（同一 Postgres 实例内）：

```bash
# 1) 用业务系统同一套口径导出真实数据（复用 buildOperationalAnalytics）
PACK_STORE_DIR=<业务库目录> npm run superset:export      # 产出 .preview/superset/projection.sql

# 2) 灌入分析库
docker compose -f deploy/superset/docker-compose.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -U superset -d analytics < .preview/superset/projection.sql
```

事实表：`fact_exception_type` / `fact_resolution_stage` / `fact_rule_performance` / `fact_source_system`。
单租户 pilot：每次只导出配置中绑定的那一个产品租户，投影库不混入其它租户数据。

## 创建 datasource / dataset / 图表 / dashboard 并开启嵌入

```bash
node scripts/superset-setup.mjs
```

脚本幂等执行：创建 `fep analytics` 数据库连接（指向 `analytics` 库）→ 4 个 dataset →
4 个图表（异常类型分布 / 治理推进 / 规则触发率 / 来源系统分布）→ 1 个 dashboard →
开启嵌入并按白名单重建 embedded 配置，最后把 dashboard UUID 写回 `.env` 的
`SUPERSET_DASHBOARD_ID`。脚本只读 `.env`，不打印任何密钥。

## 业务后端接入

后端新增：

- `GET /api/v2/analytics/providers` —— 返回当前 provider 与是否已配置（决定 `/analytics` 渲染哪一套）
- `GET /api/v2/analytics/superset/guest-token` —— 先 `analytics:read` scope 校验，再产品租户边界校验，
  然后由后端用服务账号调 Superset 换取短生命周期 guest token

浏览器只拿到 `dashboardId / supersetDomain / guestToken / expiresInSeconds`，不接触
Superset 管理员密码、服务账号或 JWT 签名密钥；`/analytics` 用官方
`@superset-ui/embedded-sdk` 的 `embedDashboard({ id, supersetDomain, mountPoint, fetchGuestToken })`
渲染，token 过期由 SDK 再次回调后端续签。

## 本地验证状态（真值边界）

```text
SUPERSET_STACK_LOCAL_STARTED=true           # compose 可启动并完成初始化
SUPERSET_PROJECTION_LOADED=true             # 真实业务数据已导入 analytics 库
SUPERSET_GUEST_TOKEN_ISSUED=true            # 后端可签发真实 guest token（Superset 侧 200）
SUPERSET_EMBED_IMPLEMENTED=true             # 后端接口 + provider 切换 + 官方 SDK 接入已实现
SUPERSET_LOCAL_DASHBOARD_VERIFIED=true      # 浏览器里 4 个模块真实渲染（见下）
SUPERSET_REAL_CUSTOMER_VERIFIED=false
SUPERSET_MULTITENANT_RLS_VERIFIED=false
SUPERSET_PRODUCTION_HA_VERIFIED=false
```

这一步曾经失败（iframe 已加载且嵌入页返回 200，但嵌入应用随后对 Superset API 的调用
一律 403），根因已定位并修复：

1. **`GUEST_ROLE_NAME` 落在官方默认 `Public`**，而 `Public` 在 `superset init` 之后
   0 条权限；guest token 的授权只来自这一个 role，所以每个 API 调用都 403。
   Gamma 对照实验确认后，改为初始化脚本幂等创建的专用最小权限 role
   `EmbeddedGuest`（4 条 `can_read` + 当前 4 张事实表的 `datasource_access`）。
2. **`dashboard_slices` 是空的**：Superset 只在 PUT 的 `json_metadata.positions` 里
   同步 dashboard ↔ chart 关联，只写 `position_json` 会让看板渲染成空白。

另外确认的事实：Superset 6.1 已移除旧的 `bar` viz plugin；`/api/v1/dashboard/<uuid>`
不接受嵌入式 uuid，嵌入页通过 bootstrap 把数字 dashboard id 交给 SPA，因此嵌入应用
真正调用的是 `/api/v1/dashboard/<数字 id>/...`。`@superset-ui/embedded-sdk@0.4.0`
与 6.1 服务端没有发现兼容性问题——本轮未升级 SDK、未改 CORS、未关闭 CSRF、
未使用 `all_datasource_access`、未使用 Admin/Gamma 作为长期角色。

复现与验证：`npm run superset:init-role`（幂等收敛 role）、
`npm run superset:verify-embed`（22 项真实链路检查，含 `POST /api/v1/chart/data`
必须返回真实行）。

## 不要做的事

- 不要把 compose 当成生产/高可用部署（官方明确不支持）
- 不要提交 `.env` 中的任何真实密码或密钥
- 不要在浏览器侧保存 Superset 管理员密码、服务账号或 JWT 签名密钥
- 本轮不声明多租户 RLS、真实客户验证或生产 HA 任一状态
