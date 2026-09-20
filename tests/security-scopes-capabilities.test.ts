import { describe, expect, it } from "vitest";
import {
  CANONICAL_ROLES,
  ROLE_SCOPES,
  SCOPES,
  WILDCARD_SCOPE,
  hasScope,
  resolveIdentityScopes,
} from "../src/security/scopes.js";
import { buildIdentityCapabilities } from "../src/security/capabilities.js";
import { SENSITIVE_AUDIT_ACTIONS, sanitizeAuditMetadata } from "../src/security/audit.js";
import { assertScope, effectiveScopes } from "../src/auth.js";

describe("scope catalog", () => {
  it("covers the agreed scopes and nothing else", () => {
    expect([...SCOPES]).toEqual([
      "context:read",
      "exception:read",
      "evidence:read",
      "decision:read",
      "decision:recommend",
      "governance:read",
      "governance:submit",
      "governance:approve",
      "governance:reject",
      "execution:read",
      "execution:run",
      "analytics:read",
      "connector:read",
      "connector:manage",
      "solution-pack:read",
      "solution-pack:manage",
      "admin:tenant",
      "admin:user",
      "admin:role",
    ]);
    expect([...CANONICAL_ROLES]).toEqual(["viewer", "operator", "reviewer", "approver", "admin"]);
  });

  it("maps canonical roles to monotonically wider scope sets", () => {
    const viewer = new Set(ROLE_SCOPES.viewer);
    const operator = new Set(ROLE_SCOPES.operator);
    const approver = new Set(ROLE_SCOPES.approver);
    expect([...viewer].every((scope) => operator.has(scope))).toBe(true);
    expect([...viewer].every((scope) => approver.has(scope))).toBe(true);
    expect(operator.has("governance:submit")).toBe(true);
    expect(operator.has("governance:approve")).toBe(false);
    expect(approver.has("governance:approve")).toBe(true);
    expect(approver.has("execution:run")).toBe(true);
    expect(ROLE_SCOPES.admin).toHaveLength(SCOPES.length);
    // 只有 admin 拿得到管理类 scope
    for (const role of ["viewer", "operator", "reviewer", "approver"] as const) {
      expect(ROLE_SCOPES[role]).not.toContain("connector:manage");
      expect(ROLE_SCOPES[role]).not.toContain("solution-pack:manage");
      expect(ROLE_SCOPES[role]).not.toContain("admin:tenant");
    }
  });

  it("derives scopes from roles when the token declares none", () => {
    const viewer = resolveIdentityScopes({ roles: ["viewer"] });
    expect(viewer.canonicalRoles).toEqual(["viewer"]);
    expect(viewer.scopes).toContain("context:read");
    expect(viewer.scopes).not.toContain("governance:submit");

    const operator = resolveIdentityScopes({ roles: ["品质负责人"] });
    expect(operator.canonicalRoles).toEqual(["operator"]);
    expect(operator.scopes).toContain("governance:submit");
    expect(operator.scopes).not.toContain("governance:approve");

    const approver = resolveIdentityScopes({ roles: ["总经理"] });
    expect(approver.canonicalRoles).toEqual(["approver"]);
    expect(approver.scopes).toContain("governance:approve");
    expect(approver.scopes).toContain("execution:run");

    const admin = resolveIdentityScopes({ roles: ["管理员"] });
    expect(admin.canonicalRoles).toEqual(["admin"]);
    expect(admin.scopes).toContain("admin:tenant");

    const unknown = resolveIdentityScopes({ roles: ["某未知角色"] });
    expect(unknown.canonicalRoles).toEqual([]);
    expect(unknown.unknownRoles).toEqual(["某未知角色"]);
    expect(unknown.scopes).toEqual([]);
  });

  it("lets explicit token scopes win over role derivation", () => {
    const narrow = resolveIdentityScopes({ roles: ["viewer"], scopes: ["analytics:read"] });
    expect(narrow.catalogScopes).toEqual(["analytics:read"]);
    expect(hasScope(narrow, "analytics:read")).toBe(true);
    expect(hasScope(narrow, "context:read")).toBe(false);
    expect(hasScope(narrow, "governance:submit")).toBe(false);
  });

  it("keeps declared non-catalog (legacy) scopes verbatim", () => {
    const legacy = resolveIdentityScopes({ roles: ["销售总监"], scopes: ["fulfillment:sales"] });
    expect(legacy.extraScopes).toEqual(["fulfillment:sales"]);
    expect(hasScope(legacy, "fulfillment:sales")).toBe(true);
    expect(hasScope(legacy, "it-alert:ops")).toBe(false);
    // 声明了具体 scope 就不再由角色推导
    expect(hasScope(legacy, "analytics:read")).toBe(false);
  });

  it("flags the wildcard as DEMO_ONLY_SUPERUSER instead of a production capability", () => {
    const demo = resolveIdentityScopes({ roles: ["viewer"], scopes: [WILDCARD_SCOPE] });
    expect(demo.demoOnlySuperuser).toBe(true);
    expect(hasScope(demo, "admin:role")).toBe(true);
    const capabilities = buildIdentityCapabilities({ tenantId: "demo-manufacturing", roles: ["viewer"], scopes: [WILDCARD_SCOPE] });
    expect(capabilities.demoOnlySuperuser).toBe(true);
    expect(capabilities.scopes).toEqual([]);
    expect(capabilities.canApprove).toBe(true);
  });
});

describe("identity capability projection", () => {
  it("projects viewer / operator / approver capabilities server-side", () => {
    const viewer = buildIdentityCapabilities({ tenantId: "tenant-a", roles: ["viewer"], scopes: [] });
    expect(viewer).toMatchObject({
      actorType: "user",
      canonicalRoles: ["viewer"],
      canReadEvidence: true,
      canRecommend: false,
      canSubmit: false,
      canApprove: false,
      canExecute: false,
      canManageConnectors: false,
    });

    const operator = buildIdentityCapabilities({ tenantId: "tenant-a", roles: ["品质负责人"], scopes: [] });
    expect(operator).toMatchObject({ canRecommend: true, canSubmit: true, canApprove: false, canReject: false });

    const approver = buildIdentityCapabilities({ tenantId: "tenant-a", roles: ["总经理"], scopes: [] });
    expect(approver).toMatchObject({ canSubmit: false, canApprove: true, canReject: true, canExecute: true, canManageTenant: false });

    const admin = buildIdentityCapabilities({ tenantId: "tenant-a", roles: ["管理员"], scopes: [] });
    expect(admin).toMatchObject({ canApprove: true, canExecute: true, canManageConnectors: true, canManageSolutionPacks: true, canManageTenant: true });
  });

  it("exposes system actors explicitly (connector runtime is not a browser user)", () => {
    const systemActor = buildIdentityCapabilities(
      { tenantId: "tenant-a", roles: ["管理员"], scopes: [] },
      { actorType: "system" },
    );
    expect(systemActor.actorType).toBe("system");
  });
});

describe("auth scope enforcement helpers", () => {
  it("asserts scope from role-derived capabilities and rejects the rest", () => {
    const context = {
      subjectId: "u1",
      tenantId: "tenant-a",
      roles: ["品质负责人"],
      scopes: [] as string[],
      displayName: "u1",
      organizationName: "tenant-a",
      organizationSource: "tenant_fallback" as const,
      authnMethod: "jwt-hs256" as const,
    };
    expect(effectiveScopes(context).scopes).toContain("governance:submit");
    expect(() => assertScope(context, "governance:submit")).not.toThrow();
    expect(() => assertScope(context, "governance:approve")).toThrow(/scope_forbidden/);
    // 目录外、且未声明的 scope 一律拒绝
    expect(() => assertScope(context, "it-alert:ops")).toThrow(/scope_forbidden/);
  });
});

describe("audit hygiene", () => {
  it("covers the sensitive mutation actions", () => {
    expect(SENSITIVE_AUDIT_ACTIONS).toEqual(expect.arrayContaining([
      "decision.recommend",
      "resolution.submit",
      "resolution.approve",
      "resolution.execute",
      "connector.install",
      "solution_pack.install",
    ]));
  });

  it("drops unknown metadata keys so secrets and headers can never be persisted", () => {
    const sanitized = sanitizeAuditMetadata({
      contextId: "ctx-1",
      exceptionId: "ex-1",
      status: "proposed",
      authorization: "Bearer top-secret",
      password: "hunter2",
      token: "jwt",
      nested: { secret: "x" },
    });
    expect(sanitized).toEqual({ contextId: "ctx-1", exceptionId: "ex-1", status: "proposed" });
    expect(JSON.stringify(sanitized)).not.toContain("top-secret");
    expect(JSON.stringify(sanitized)).not.toContain("hunter2");
  });
});
