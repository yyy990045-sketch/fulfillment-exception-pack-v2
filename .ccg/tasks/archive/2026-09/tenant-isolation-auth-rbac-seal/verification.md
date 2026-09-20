# 验证记录

审计：46 条 /api/v2 路由定义；改动前仅 4 处 assertScope（1 处 legacy /api/cases + 3 处 analytics），
即 43 条路由「只认证不鉴权」；1 条路由（GET /api/v2/solution-packs/{packId}）连认证都没有。

修复：
1. 统一 scope 目录（19 个）+ 5 个规范角色 + 角色别名映射（src/security/scopes.ts）；
   token 显式 scopes 优先，未声明才由 roles 推导；`*` 标记 DEMO_ONLY_SUPERUSER。
2. 46 条 /api/v2 路由全部加 scope 闸门（身份端点除外）；mutation 顺序
   authenticate → scope → 只读主体检查 → tenant → workflow → policy。
3. GET /api/v2/auth/me：identity + canonicalRoles + scopes + backend capability projection。
4. 租户边界：跨租户与不存在统一 404（resolution accept 路径补了显式存在性检查，
   原先会 403 EXCEPTION_NOT_DETECTED 泄漏存在性）。
5. 审计：新增 security_audit_events（migration 018）+ 19 处敏感 mutation 埋点 +
   metadata 白名单（JWT/secret/header 永不落库）。
6. SoD：approve 的职责分离本就在领域层，本轮补 HTTP 级证据与文档。
7. OpenAPI：新增 /api/v2/auth/me + IdentityProjection/IdentityCapabilities，并重新生成 schema.d.ts。

测试：
- npm test 421/421（71 文件）；frontend:test 64/64；frontend:e2e 6/6
- typecheck / eval / superset:verify-embed 22 项 / open-supos:verify --mode contract 全部通过
- 新增 tests/security-scopes-capabilities.test.ts（11）与
  tests/security-rbac-tenant-isolation.test.ts（12，含跨租户 404 全覆盖、SoD、审计、/auth/me）

真值：AUTH_RBAC_* / TENANT_ISOLATION_* / GOVERNANCE_SOD_* / CAPABILITY_PROJECTION_IMPLEMENTED = true；
ENTERPRISE_SSO_VERIFIED / REAL_CUSTOMER_RBAC_VERIFIED / PRODUCTION_IAM_VERIFIED 保持 false。
