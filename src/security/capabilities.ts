/**
 * Identity capability projection。
 *
 * 前端不允许自己推断 canSubmit / canApprove / canExecute——
 * 能力由后端按 identity + role + scope + tenant 计算后统一下发。
 * 对象级（某个异常/治理单能不能做某动作）能力仍然由
 * `/api/v2/contexts/{contextId}/exceptions/{exceptionId}/resolution-capabilities` 提供。
 */
import type { AuthContext } from "../auth.js";
import { effectiveScopes } from "../auth.js";
import type { CanonicalRole, Scope } from "./scopes.js";

export type ActorType = "user" | "system";

export type IdentityCapabilities = {
  actorType: ActorType;
  canonicalRoles: CanonicalRole[];
  scopes: Scope[];
  /** DEMO 身份带 `*`；只在本轮标记，不允许用于 production */
  demoOnlySuperuser: boolean;
  canReadContext: boolean;
  canReadException: boolean;
  canReadEvidence: boolean;
  canRecommend: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canExecute: boolean;
  canReadAnalytics: boolean;
  canManageConnectors: boolean;
  canManageSolutionPacks: boolean;
  canManageTenant: boolean;
};

export function buildIdentityCapabilities(
  auth: Pick<AuthContext, "roles" | "scopes" | "tenantId">,
  options: { actorType?: ActorType } = {},
): IdentityCapabilities {
  const resolved = effectiveScopes(auth);
  const allows = (scope: Scope) => resolved.demoOnlySuperuser || resolved.catalogScopes.includes(scope);
  return {
    actorType: options.actorType ?? "user",
    canonicalRoles: resolved.canonicalRoles,
    scopes: resolved.demoOnlySuperuser ? [] : resolved.catalogScopes,
    demoOnlySuperuser: resolved.demoOnlySuperuser,
    canReadContext: allows("context:read"),
    canReadException: allows("exception:read"),
    canReadEvidence: allows("evidence:read"),
    canRecommend: allows("decision:recommend"),
    canSubmit: allows("governance:submit"),
    canApprove: allows("governance:approve"),
    canReject: allows("governance:reject"),
    canExecute: allows("execution:run"),
    canReadAnalytics: allows("analytics:read"),
    canManageConnectors: allows("connector:manage"),
    canManageSolutionPacks: allows("solution-pack:manage"),
    canManageTenant: allows("admin:tenant"),
  };
}
