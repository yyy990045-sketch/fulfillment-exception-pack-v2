/**
 * 统一 scope 目录与 role → scope 映射。
 *
 * 规则：
 *   1. scope 只在 `SCOPES` 里定义；不为单个 endpoint 发明新 scope。
 *   2. role 只有 5 个规范值：viewer / operator / reviewer / approver / admin。
 *      历史与演示用的中文角色名（品质负责人、销售总监…）通过别名映射到规范角色，
 *      不改变领域层已有的 workflow 授权语义。
 *   3. `*` 只允许出现在 DEMO 身份上，并显式标记为 DEMO_ONLY_SUPERUSER。
 */

export const SCOPES = [
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
] as const;

export type Scope = (typeof SCOPES)[number];

export const WILDCARD_SCOPE = "*";

export const CANONICAL_ROLES = ["viewer", "operator", "reviewer", "approver", "admin"] as const;
export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

const READ_SCOPES: Scope[] = [
  "context:read",
  "exception:read",
  "evidence:read",
  "decision:read",
  "governance:read",
  "execution:read",
  "analytics:read",
  "connector:read",
  "solution-pack:read",
];

export const ROLE_SCOPES: Record<CanonicalRole, Scope[]> = {
  viewer: READ_SCOPES,
  // 日常异常处理：可以给出建议、可以把方案提交审批
  operator: [...READ_SCOPES, "decision:recommend", "governance:submit"],
  // 复核：在 operator 基础上可以驳回
  reviewer: [...READ_SCOPES, "decision:recommend", "governance:submit", "governance:reject"],
  // 审批：可以批准/驳回，并执行已批准方案
  approver: [...READ_SCOPES, "governance:approve", "governance:reject", "execution:run"],
  // 管理：配置与管理（仍然不能绕过 tenant / workflow / SoD）
  admin: [...SCOPES],
};

/**
 * 历史/演示角色名 → 规范角色。
 * 这些名字继续被领域层（resolution authorization）使用，这里只做 scope 推导，不改语义。
 */
export const LEGACY_ROLE_ALIASES: Record<string, CanonicalRole[]> = {
  viewer: ["viewer"],
  品质负责人: ["operator"],
  工程师: ["operator", "reviewer"],
  销售总监: ["reviewer", "approver"],
  财务: ["reviewer", "approver"],
  总经理: ["approver"],
  管理员: ["admin"],
};

export type ResolvedIdentityScopes = {
  canonicalRoles: CanonicalRole[];
  /** 目录内的有效 scope（用于能力投影） */
  catalogScopes: Scope[];
  /** token 显式声明但不在目录内的 scope（历史域名 scope，如 fulfillment:sales），原样保留 */
  extraScopes: string[];
  /** 参与鉴权判断的完整 scope 集合（catalogScopes + extraScopes） */
  scopes: string[];
  /** 显式出现 `*`（只应来自 DEMO 身份） */
  demoOnlySuperuser: boolean;
  /** 无法识别的角色名（既不是规范角色也不是已知别名） */
  unknownRoles: string[];
};

export function resolveIdentityScopes(input: {
  roles: string[];
  scopes?: string[];
}): ResolvedIdentityScopes {
  const canonical = new Set<CanonicalRole>();
  const unknownRoles: string[] = [];
  for (const role of input.roles) {
    const trimmed = role.trim();
    if (!trimmed) continue;
    if ((CANONICAL_ROLES as readonly string[]).includes(trimmed)) {
      canonical.add(trimmed as CanonicalRole);
      continue;
    }
    const aliased = LEGACY_ROLE_ALIASES[trimmed];
    if (aliased) {
      for (const item of aliased) canonical.add(item);
      continue;
    }
    unknownRoles.push(trimmed);
  }

  const granted = new Set<Scope>();
  for (const role of canonical) for (const scope of ROLE_SCOPES[role]) granted.add(scope);

  const declared = (input.scopes ?? []).map((scope) => scope.trim()).filter(Boolean);
  const demoOnlySuperuser = declared.includes(WILDCARD_SCOPE);
  // 显式声明优先：token 一旦声明了具体 scope，就以声明为准（可用最小权限 token），
  // 不再由角色推导；只有完全没声明 scope 的 token 才使用 role → scope 映射。
  const hasDeclaredScopes = declared.some((scope) => scope !== WILDCARD_SCOPE && scope.length > 0);
  const catalogScopes = SCOPES.filter((scope) => hasDeclaredScopes ? declared.includes(scope) : granted.has(scope));
  const extraScopes = hasDeclaredScopes
    ? declared.filter((scope) => scope !== WILDCARD_SCOPE && !(SCOPES as readonly string[]).includes(scope))
    : [];

  return {
    canonicalRoles: CANONICAL_ROLES.filter((role) => canonical.has(role)),
    catalogScopes,
    extraScopes,
    scopes: [...catalogScopes, ...extraScopes],
    demoOnlySuperuser,
    unknownRoles,
  };
}

export function hasScope(resolved: ResolvedIdentityScopes, scope: string) {
  return resolved.demoOnlySuperuser || resolved.scopes.includes(scope);
}
