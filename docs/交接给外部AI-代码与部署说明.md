# 履约例外处理台：外部 AI 交接说明

## 交接目标

请把本仓库视为一个已经完成本地闭环的比赛工程快照。先基于当前代码核对事实，再提出问题、修改方案和回归测试；不要把 README 或旧材料当成实现依据。

本项目不是企业生产平台，也不连接真实 CRM、真实回单或其他生产数据库。仓库内只有合成案例和本地确定性处理逻辑。

## 当前闭环

`Evidence Pack → Case/Conflict → Finding → Action → 审批 → 本地能力台账回执 → 核验结案`

主流程状态：`reviewed → proposed → approved → executed → verified → closed`。未完成差异核对、未提交负责人确认或没有本地台账回执时，不允许结案。

## 代码导航

- `src/server.ts`：HTTP 服务、认证、路由、错误码、SSE/静态文件入口。
- `src/auth.ts`：生产 HS256 JWT 校验；生产模式拒绝演示兼容头。
- `src/store.ts`：租户/案件隔离、SQLite WAL 事务、本地 JSON 兼容存储、能力回执台账。
- `src/case/runtime.ts`：案件状态机、审批门禁、执行幂等、回执核验和结案。
- `src/types.ts`：前后端共享类型与回执字段。
- `src/workbench/index.html`：浏览器工作台和状态展示。
- `src/eval/`、`tests/`：评测样例、单元测试和 UI 契约测试。
- `contracts/openapi.yaml`：当前 API 契约；修改 API 时必须同步更新。
- `Dockerfile`、`docker-compose.deploy.yml`、`.env.production.example`：部署模板。

## 本地运行

```bash
npm install
npm test
npm run typecheck
npm run eval
npm run demo
```

浏览器只使用 `http://127.0.0.1:3410`。生产模式需要由密钥管理器注入长度不少于 32 字节的 `AUTH_SECRET`，不能把真实密钥写入仓库、压缩包或聊天记录。

## 生产边界

生产启动条件：`NODE_ENV=production`、`DEMO_MODE=false`、`AUTH_SECRET`、`PACK_STORE_BACKEND=sqlite`。生产请求使用 HS256 Bearer JWT，必须包含 `sub`、`tenant_id`、`roles`、`scopes`、`exp`。`x-tenant-id`/`x-actor` 仅用于非生产演示。

## 指定部署服务器

- 主机：`134.175.111.217`
- 登录用户：`ubuntu`
- SSH 目标：`ubuntu@134.175.111.217`
- 应用建议监听：`0.0.0.0:3410`（外部访问由反向代理或安全组控制）
- 数据目录：`/opt/fulfillment-exception-pack/data`
- 发布目录：`/opt/fulfillment-exception-pack`

服务器地址已由项目负责人提供，但交接包不包含 SSH 私钥、密码、Token 或真实 `AUTH_SECRET`。外部 AI 不得索要这些敏感值；部署人员应在服务器上通过受保护的密钥管理方式注入。

### 建议部署顺序

```bash
# 在本机上传代码包（将 <KEY> 替换为部署人员本机已有的私钥路径）
scp -i <KEY> fulfillment-exception-pack-code-handoff-2026-09-08.zip ubuntu@134.175.111.217:/tmp/

# 登录服务器
ssh -i <KEY> ubuntu@134.175.111.217

# 服务器上准备目录并解压
sudo mkdir -p /opt/fulfillment-exception-pack/data
sudo chown -R ubuntu:ubuntu /opt/fulfillment-exception-pack
cd /opt/fulfillment-exception-pack
unzip -o /tmp/fulfillment-exception-pack-code-handoff-2026-09-08.zip

# 配置生产环境（真实密钥只在服务器受保护环境中注入）
cp .env.production.example .env.production
${EDITOR:-vi} .env.production

# 启动、查看状态和日志
docker compose --env-file .env.production -f docker-compose.deploy.yml up --build -d
docker compose --env-file .env.production -f docker-compose.deploy.yml ps
docker compose --env-file .env.production -f docker-compose.deploy.yml logs --tail=200
```

### 服务器验收

```bash
curl -fsS http://127.0.0.1:3410/health
curl -fsS http://127.0.0.1:3410/api/cases
```

生产 API 需要带合法的 HS256 Bearer JWT；不要用演示兼容头验证生产模式。验收闭环应按 `review → propose → approve → execute → receipts → close` 顺序完成，并确认 `/app/data` 对应的持久卷在容器重启后仍能读到案件和能力台账回执。

### 回滚

发布失败时先保留日志和 SQLite 数据，再停止当前容器并切换到上一个已验证镜像或代码目录；不要删除 `/opt/fulfillment-exception-pack/data`，也不要重置或覆盖数据库文件。

## 已完成的本地证据

- `npm test`：33/33 通过。
- `npm run typecheck`：通过。
- `npm run eval`：30 个评测用例，失败 0；动作评测 23/23。
- Docker 本地构建和 JWT 生产模式闭环已验证。
- EGo 浏览器已完成“核对 → 拟定 → 审批 → 执行 → 回执 → 结案”，并验证 SQLite 重启后回执仍存在。

以上是本机/本地容器证据，不等同于真实线上部署、真实用户验收或官方平台发布证明。

## 给外部 AI 的工作提示词

你现在是一名独立的资深全栈代码审查与修复工程师。请完整阅读当前仓库和本交接文档，以当前代码为准，不盲信 README、旧报告或注释。

目标：检查并改进履约例外处理台的前后端逻辑、API 契约、认证、持久化、状态机、缓存、SSE、错误降级和证据可追溯性，确保修改后仍能完成完整闭环。

要求：

1. 先列出可复现问题，给出文件路径、行号、触发条件、实际/预期行为和最小修复方案。
2. 未经明确授权不要删除文件、重写历史数据或连接公网服务；测试只使用 `127.0.0.1`。
3. 不索要 Secret、Cookie、Access Token、SSH 私钥、真实用户数据或真实 CRM 地址。
4. 修改前后都运行 `npm test`、`npm run typecheck`、`npm run eval`；涉及 API 时同步检查 `contracts/openapi.yaml`。
5. 每个修复都补充回归测试，并说明哪些结论仍然“无法验证”。
6. 不要把合成数据、本地测试或 Docker 通过写成真实客户效果、商业部署或官方获奖证明。
7. 最终输出：变更文件清单、问题与修复表、测试结果、未验证边界、部署注意事项，以及是否仍能完成 `reviewed → proposed → approved → executed → verified → closed`。

## 禁止误解

- 本地能力台账回执是可追溯的演示实现，不是第三方真实系统回执。
- 代码包可以交给 AI 做审查和修改，但不要把源代码或配置上传到公开网站。
- 比赛 PDF/DOCX、演示视频、Agent 体验链接、团队信息仍需按赛事通道单独提交。
