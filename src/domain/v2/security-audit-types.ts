/**
 * 安全审计事件（governance / connector / solution pack 等敏感 mutation 的留痕）。
 *
 * 只记录谁在哪个租户做了什么、结果如何；**不**记录 JWT、密码、secret、
 * authorization header 或请求原文。
 */
export type SecurityAuditActorType = "user" | "system";

export type SecurityAuditEventRecord = {
  tenantId: string;
  id: string;
  actorType: SecurityAuditActorType;
  subjectId: string;
  roles: string[];
  action: string;
  resourceType: string;
  resourceId: string;
  result: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};
