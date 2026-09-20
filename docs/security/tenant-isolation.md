# 租户隔离（Tenant Isolation）

适用范围：`/api/v2`。目标：tenant A 的 token 无法读取或修改 tenant B 的任何业务资源，
且**不泄漏资源是否存在**。

## Truth flags

```text
TENANT_ISOLATION_IMPLEMENTED=true
TENANT_ISOLATION_LOCALLY_VERIFIED=true

ENTERPRISE_SSO_VERIFIED=false
REAL_CUSTOMER_RBAC_VERIFIED=false
PRODUCTION_IAM_VERIFIED=false
```

## 单一事实来源：租户来自 token

```text
tenantId = AuthContext.tenantId   // 演示头（DEMO）或 JWT claim tenant_id
```

- 任何请求体里出现 `tenant` / `tenantId` 都返回 400：
  `tenant_from_auth_required` / `actor_and_tenant_from_auth_required`。
- 路由不再接受调用方自带的租户参数；`pack-install` / `connector-install` 等还会拒绝
  `actor` / `roles` / `tenant` 字段（`*_FIELDS_FORBIDDEN`）。

## 两层校验（不只依赖 SQL filter）

```text
第 1 层：Store 查询一律带 tenant_id
  fulfillment_contexts / business_entities / v2_evidence / exceptions /
  resolution_cases / decision_recommendations / policy_evaluations / automation_runs /
  outcome_evaluations / connector_installations / connector_outbox /
  connector_source_records / solution_pack_installations / security_audit_events

第 2 层：handler 边界的显式存在性检查
  - store.getContext(tenantId, contextId) 不存在 → 404
  - 通过 context 反查 exception / bundle / resolution case → 不属于本租户 → 404
  - 能力/流程判定（canXxxResolution）只在资源确认属于本租户之后才执行
```

第 2 层是必要的：如果先跑能力判定，跨租户请求会拿到 403/409（例如
`EXCEPTION_NOT_DETECTED`），从而**泄漏「这个 ID 存在但不属于你」**。
`POST /api/v2/contexts/{id}/exceptions/{id}/resolution-case` 已显式改为先做租户边界检查。

## 统一响应语义（IDOR）

```text
tenant A 请求 tenant B 的资源        → 404 { "error": "not_found" }
资源不存在（任何租户都没有）           → 404 { "error": "not_found" }
资源属于当前租户但权限/scope 不足      → 403（scope_forbidden / ROLE_NOT_ALLOWED …）
资源属于当前租户但流程状态不允许       → 409（ACTION_NOT_APPLICABLE / SoD / RECEIPT_REQUIRED）
```

跨租户与不存在**不可区分**；403 只用于「已经确认属于你、但你不够格」。

## 覆盖的资源面

```text
Context        GET /api/v2/contexts/{contextId}/replay | /workbench | /pack-workbench | /exceptions | /rule-evaluations
Exception      GET /api/v2/contexts/{contextId}/exceptions
Evidence       GET .../exceptions/{exceptionId}/bundle | /explanations[/{explanationId}]
Decision       GET/POST .../decision-recommendations[/{id}][/dispositions]
Policy         GET/POST .../policy-evaluations[/{id}/automation-readiness|/automation-runs]
Execution      GET .../automation-runs[/{id}] | GET/POST /api/v2/internal-work-items[/{id}/deliveries]
Outcome        GET/POST .../outcome-evaluations[/{id}]
Resolution     GET /api/v2/resolution-cases/{caseId} | /api/v2/contexts/{contextId}/resolution-cases
Connector      GET /api/v2/connectors/installed | outbox/{id}[/attempts] | POST /connectors/{id}/install
Solution Pack  GET /api/v2/solution-packs/installed | /{packId} | POST /{packId}/install
Analytics      GET /api/v2/analytics/operational | powerbi/embed-config | providers | superset/guest-token
Audit          store.listSecurityAuditEvents(tenantId, …)（按租户过滤）
```

## 验证证据

`tests/security-rbac-tenant-isolation.test.ts` 在 `DEMO_MODE=false` + 真实 JWT 下构造两个租户
（tenant-a 为 demo-manufacturing 的真实上下文；tenant-b 由真实行复制而来），并断言：

```text
跨租户读  context / exceptions / evidence bundle / resolution case → 全部 404
跨租户写  accept(受理) → 404；approve(治理单) → 404
admin 跨租户 → 仍然 404（没有 global-admin 旁路）
本租户访问 → 200（tenant-b 自己与 tenant-a 自己的资源都正常）
审计按租户隔离：tenant-a 查不到 tenant-b 的 resolution 审计
```

## Known limitations

- 演示模式（`DEMO_MODE=true`）下 `x-tenant-id` 可以指定任意租户——这是演示能力，
  生产模式必须 `DEMO_MODE=false` + JWT；本轮已在 `AUTH_SECRET` 缺失时启动失败。
- 没有引入 global-admin / 跨租户运维角色（按本轮要求不引入）。
- Analytics 投影仍是**单租户 pilot**口径（一次只导出配置中绑定的那一个租户），
  这不构成多租户 RLS 证据。
- 隔离证据只到本地 SQLite + HTTP 边界；不代表客户环境、生产 IAM 或合规审计结论。
- 审计事件存在业务库同一 SQLite 文件内，没有独立存储、WORM 或保留策略。

## 复现

```bash
npm test -- tests/security-rbac-tenant-isolation.test.ts
```

实现入口：

```text
src/server.ts                              路由层租户边界与 404 语义
src/domain/v2/sqlite-store.ts              所有查询带 tenant_id
src/domain/v2/resolution/authorization.ts  流程/角色/SoD 判定（仅在租户确认后执行）
```
