# Power BI 授权边界审查记录

范围：`git diff -- src contracts docs .env.example tests`，目标为两项授权边界修复，
不扩展 Power BI 功能、不做 RLS、不做多 workspace、不做 PBIX、不改 Analytics UI。

外部审查：`codeagent-wrapper --backend claude`（只读，reviewer 角色）。
antigravity 后端不可用，缺少 `agy` CLI，因此本轮为单后端审查。

## 已采纳并落地

- 缺 HTTP 级 demo-mode 覆盖：新增 demo `x-tenant-id` 请求，证明演示身份的 `scopes: ["*"]` 仍通过
  scope 门（返回 503 而非 403），且 demo 身份在 tenant 不匹配时仍 fail closed 返回
  403 `POWERBI_TENANT_FORBIDDEN`。
- OpenAPI 403 描述原先混指两种禁止情形：改为明确 error body 区分 `scope_forbidden`
  与 `POWERBI_TENANT_FORBIDDEN`。
- OpenAPI 契约测试原先只断言存在 `'503'`：补充 `'403'`、`scope_forbidden`、
  `POWERBI_TENANT_FORBIDDEN`，并把泄漏断言扩展到 `clientId` / `entraTenantId` / `productTenantId`。
- 文档补充：`POWERBI_PRODUCT_TENANT_ID` 不得复用演示模式默认租户 `demo-manufacturing`。

## 已评估但不采纳（含理由）

- 要求在 HTTP 层断言错误 tenant 场景「零 Entra/Power BI 调用」：现有断言已经足够，
  因为该服务使用占位凭据，任何提前发起的 Entra 调用都会失败并返回 502 而不是
  403，回归会被状态码与错误体双重断言捕获；服务层单测另有 `getAccessToken` /
  `fetchImpl` 未被调用的显式断言。
- 要求新增 HTTP 层 happy-path（200 + embed 配置）：当前 Power BI REST 基址
  `https://api.powerbi.com/v1.0/myorg` 是硬编码常量，HTTP 层无法在不引入可注入
  基址的前提下被 stub。为此改产品代码属于扩大范围，故保持服务层 happy-path 覆盖。
- 要求让 `scope_forbidden` 403 也带 `Cache-Control: no-store`：这是全仓库
  `AuthError` 处理器的既有行为（所有端点一致），不是本次 Power BI 边界引入的缺口，
  且修复需要改动全局错误处理，超出「只修两个授权边界问题」的范围，记录为后续项。

## 验证

- `npm test`: 64 files / 369 tests passed
- `npm run frontend:test`: 9 files / 59 tests passed
- `npm run frontend:e2e`: 6 passed
- `npm run eval`: exit 0
- `git diff --check`: clean
- `npm run typecheck`: 后端 `tsc --noEmit` 通过；前端报错位于未提交的
  `frontend/src/features/manufacturing/components/context-bi.tsx`（未纳入本次改动，属既有 WIP）

## 真值边界

`POWERBI_REAL_REPORT_VERIFIED`、`POWERBI_RLS_VERIFIED`、
`POWERBI_MULTITENANT_ISOLATION_VERIFIED`、`POWERBI_PRODUCTION_CAPACITY_VERIFIED`
保持 `false`，`LIVE_VERIFICATION_STATUS` 保持 `BLOCKED_BY_CONFIGURATION`。
`MULTITENANT_POWERBI_ISOLATION=false` 不变；本次实现的是单租户授权边界，
不是多租户 Power BI 隔离。
