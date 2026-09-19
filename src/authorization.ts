export const RESOLUTION_OWNER_ROLES = [
  "品质负责人",
  "销售总监",
  "工程师",
  "财务",
  "总经理",
  "管理员",
] as const;

export const RESOLUTION_APPROVER_ROLES = [
  "总经理",
  "管理员",
  "销售总监",
  "财务",
  "工程师",
] as const;

export type AuthorizationSubject = {
  subjectId: string;
  roles: string[];
};

export function subjectHasAnyRole(subject: AuthorizationSubject, allowedRoles: readonly string[]) {
  return allowedRoles.some((role) => subject.roles.includes(role));
}

export function isResolutionOwner(subject: AuthorizationSubject) {
  return subjectHasAnyRole(subject, RESOLUTION_OWNER_ROLES);
}

export function isResolutionApprover(subject: AuthorizationSubject) {
  return subjectHasAnyRole(subject, RESOLUTION_APPROVER_ROLES);
}

export function isAssignableOwnerRole(ownerRole: string) {
  return RESOLUTION_OWNER_ROLES.some((role) => role === ownerRole);
}
