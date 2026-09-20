# Auth / RBAC 生产封口

适用范围：`/api/v2`。本轮只做本地代码与测试，不引入企业 SSO / IdP / OAuth provider。

## Truth flags

```text
AUTH_RBAC_IMPLEMENTED=true
AUTH_RBAC_LOCALLY_VERIFIED=true
TENANT_ISOLATION_IMPLEMENTED=true
TENANT_ISOLATION_LOCALLY_VERIFIED=true
GOVERNANCE_SOD_IMPLEMENTED=true
GOVERNANCE_SOD_LOCALLY_VERIFIED=true
CAPABILITY_PROJECTION_IMPLEMENTED=true

ENTERPRISE_SSO_VERIFIED=false
REAL_CUSTOMER_RBAC_VERIFIED=false
PRODUCTION_IAM_VERIFIED=false
```

后三项为 false 的原因：本轮没有接企业 IdP、没有客户环境验证、没有生产 IAM 运维证据。

## Demo 身份 vs Production 身份

| | DEMO_MODE=true | DEMO_MODE=false |
| --- | --- | --- |
| 认证方式 | `x-tenant-id` + `x-actor` 演示头 | 必须 `Authorization: Bearer <HS256 JWT>` |
| 缺少演示头 | 401 `actor_required`（mutation） | 401 `auth_required` |
| `AUTH_SECRET` 缺失 | 允许 | **启动失败** `AUTH_SECRET_REQUIRED_IN_PRODUCTION` |
| 会不会回退到 demo 用户 | 不适用 | **不会**，没有 fallback |
| scope 来源 | 演示身份声明 `["*"]` | token 显式 `scopes`，或由 `roles` 推导 |

演示身份的 `["*"]` 保留是为了不破坏现有 demo/比赛流程，但它被显式标记：

```text
DEMO_ONLY_SUPERUSER=true   # 只允许出现在 DEMO 身份；production token 不得携带 "*"
```

`GET /api/v2/auth/me` 会返回 `capabilities.demoOnlySuperuser`，前端与运维可据此区分。

## 角色模型（5 个规范角色）

```text
viewer    只读
operator  日常异常处理 + 提交审批（decision:recommend / governance:submit）
reviewer  operator + 驳回（governance:reject）
approver  批准 / 驳回 + 执行已批准方案（governance:approve / execution:run）
admin     配置与管理（connector:manage / solution-pack:manage / admin:*）
```

历史与演示用的中文角色名继续可用，通过别名映射到规范角色（不改领域层 workflow 语义）：

```text
viewer            → viewer
品质负责人          → operator
工程师             → operator + reviewer
销售总监 / 财务      → reviewer + approver
总经理             → approver
管理员             → admin
```

无法识别的角色名不会获得任何 scope（`unknownRoles` 会出现在解析结果里，便于排查）。

## Scope 目录（唯一来源：`src/security/scopes.ts`）

```text
context:read            exception:read          evidence:read
decision:read           decision:recommend
governance:read         governance:submit       governance:approve      governance:reject
execution:read          execution:run
analytics:read
connector:read          connector:manage
solution-pack:read      solution-pack:manage
admin:tenant            admin:user              admin:role
```

不为单个 endpoint 发明 scope。`/api/v2` 的每条路由都必须声明所需 scope
（只有 `GET /api/v2/auth/context` 与 `GET /api/v2/auth/me` 属于「已认证即可」的身份端点）。

scope 解析规则：

1. token **显式声明** `scopes` → 以声明为准（可用最小权限 token），不再由角色推导；
   目录外的历史域名 scope（如 `fulfillment:sales`）原样保留，供 gold-set 案件路由使用。
2. token **未声明** `scopes` → 完全由 `roles` 按映射推导。
3. 声明了 `*` → `DEMO_ONLY_SUPERUSER`（仅 DEMO）。

## mutation 闸门顺序

```text
authenticate → scope →（demo actor / 只读主体检查）→ tenant → workflow → policy / capability
```

实现：`mutationAuth(req, scope)` = `authOf(req)` → `assertScope` → `requireMutationAuth`。
因此「合法 JWT + 缺 scope」稳定返回 403 `scope_forbidden`，不会先撞上别的检查。
之后由各 handler 继续做租户边界、流程状态（`canXxxResolution`）与 SoD 判定。

## Governance SoD（职责分离，backend 强制）

`canApproveResolution` 会比较审批人 subjectId 与方案提出人/复核人：

```text
review.actorSubjectId === approver.subjectId  → 409 SEGREGATION_OF_DUTIES_VIOLATION
runtime.proposedBySubjectId === approver.subjectId → 409 SEGREGATION_OF_DUTIES_VIOLATION
approval 身份链不完整                          → 409 APPROVAL_SUBJECT_IDENTITY_REQUIRED
角色不具备审批权限                              → 403 ROLE_NOT_ALLOWED
```

前端 disable 只是提示；这里在服务端强制，测试见 `tests/security-rbac-tenant-isolation.test.ts`
（同一 subject 提交后审批 → 409；换 subject 审批 → 200）。

## Capability projection（前端只消费结果）

```text
GET /api/v2/auth/me
  → subjectId / tenantId / roles / canonicalRoles / scopes
  → capabilities { actorType, canReadEvidence, canRecommend, canSubmit, canApprove,
                   canReject, canExecute, canReadAnalytics, canManageConnectors,
                   canManageSolutionPacks, canManageTenant, demoOnlySuperuser }

GET /api/v2/contexts/{contextId}/exceptions/{exceptionId}/resolution-capabilities
  → 对象级能力（canAccept/canReview/canPropose/canSubmit/canApprove/canExecute/canClose）
    由 角色 + 流程状态 + 证据包 + SoD 综合计算
```

`actorType` 区分 `user` 与 `system`：Connector Runtime 的写入属于系统身份，不是浏览器用户。

## Audit boundary

敏感 mutation 会写入 `security_audit_events`（migration `018_security_audit_events`）：

```text
decision.recommend / decision.disposition
resolution.accept / review / propose / submit / approve / execute / close
execution（automation.execute / internal_work_item.deliver）
connector.install / solution_pack.install
policy.evaluate / root_cause.generate / root_cause.review / explanation.generate / outcome.evaluate / rule.evaluate
```

记录字段：`tenantId / actorType / subjectId / roles / action / resourceType / resourceId /
result / occurredAt / metadata`。

`metadata` 采用**白名单**（`src/security/audit.ts` 的 `ALLOWED_METADATA_KEYS`），
因此 JWT、password、secret、authorization header、请求原文永远不会落库。

## Known limitations（不做假声明）

- 没有企业 SSO / OIDC / SAML / MFA；生产 token 目前是共享 `AUTH_SECRET` 的 HS256，
  轮换与密钥托管仍是运维责任（`ENTERPRISE_SSO_VERIFIED=false`）。
- 对象级授权只有「租户 + 工作流 + SoD」，没有细粒度共享/委派模型。
- 演示头（`x-tenant-id`/`x-actor`）在 DEMO 模式下可以指定租户，这是演示能力，
  生产模式已被 `AUTH_SECRET` 强制关闭（测试覆盖）。
- 只声明 `roles`（不带 `scopes`）的 token 不会获得 gold-set 案件路由所需的域名 scope
  （`fulfillment:sales` 等）；这类路由要么用 `*`（仅演示），要么在 token 里显式声明。
- 审计是 SQLite 内的追加表，没有 WORM/外部归档/保留策略，也没有导出接口。
- RBAC 的「验证」只到本地单机 SQLite + HTTP 边界，不代表客户环境或生产 IAM。

## 复现与验证

```bash
npm test -- tests/security-scopes-capabilities.test.ts tests/security-rbac-tenant-isolation.test.ts
npm run typecheck
```

相关实现：

```text
src/security/scopes.ts         scope 目录 / 角色映射 / 解析优先级
src/security/capabilities.ts   identity capability projection
src/security/audit.ts          审计写入 + metadata 白名单
src/auth.ts                    effectiveScopes / assertScope（角色或显式 scope）
src/server.ts                  46 条 /api/v2 路由的 scope 闸门 + /auth/me + 审计埋点
```
