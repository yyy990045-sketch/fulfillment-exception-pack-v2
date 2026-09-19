import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { demoOrganizationName } from "./application/demo-workspaces.js";

export type AuthContext = {
  subjectId: string;
  tenantId: string;
  roles: string[];
  scopes: string[];
  displayName: string;
  organizationName: string;
  organizationSource: "demo" | "claim" | "tenant_fallback";
  authnMethod: "demo-header" | "jwt-hs256";
  sessionId?: string;
};

export class AuthError extends Error {
  constructor(public readonly code: "auth_required" | "invalid_token" | "token_expired" | "tenant_forbidden" | "scope_forbidden", public readonly status = code === "tenant_forbidden" || code === "scope_forbidden" ? 403 : 401) {
    super(code);
    this.name = "AuthError";
  }
}

const READ_ONLY_ROLE = "viewer";

const DEMO_ACTORS: Record<string, { subjectId: string; displayName: string; roles: string[] }> = {
  viewer: { subjectId: "demo-viewer", displayName: "演示查看者", roles: [READ_ONLY_ROLE] },
  "quality-owner": { subjectId: "demo-quality-owner", displayName: "品质负责人", roles: ["品质负责人"] },
  "sales-director": { subjectId: "demo-sales-director", displayName: "销售总监", roles: ["销售总监"] },
  engineer: { subjectId: "demo-engineer", displayName: "工程师", roles: ["工程师"] },
  admin: { subjectId: "demo-admin", displayName: "管理员", roles: ["管理员"] },
  "general-manager": { subjectId: "demo-general-manager", displayName: "总经理", roles: ["总经理"] },
  finance: { subjectId: "demo-finance", displayName: "财务", roles: ["财务"] },
};

function base64urlJson(value: string) {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>; }
  catch { throw new AuthError("invalid_token"); }
}

function verifyJwt(token: string): AuthContext {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new AuthError("invalid_token");
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new AuthError("invalid_token");
  const [encodedHeader, encodedPayload, signature] = pieces;
  const header = base64urlJson(encodedHeader ?? "");
  if (header.alg !== "HS256" || header.typ !== "JWT") throw new AuthError("invalid_token");
  const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  const left = Buffer.from(signature ?? "");
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new AuthError("invalid_token");
  const claims = base64urlJson(encodedPayload ?? "");
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new AuthError("token_expired");
  const subjectId = typeof claims.sub === "string" ? claims.sub.trim() : "";
  const tenantId = typeof claims.tenant_id === "string" ? claims.tenant_id.trim() : "";
  if (!subjectId || !tenantId) throw new AuthError("invalid_token");
  const roles = Array.isArray(claims.roles) ? claims.roles.filter((role): role is string => typeof role === "string" && role.trim().length > 0) : [];
  const scopes = Array.isArray(claims.scopes) ? claims.scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0) : [];
  if (!roles.length || !scopes.length) throw new AuthError("invalid_token");
  const claimedOrganizationName = typeof claims.organization_name === "string" && claims.organization_name.trim()
    ? claims.organization_name.trim()
    : typeof claims.org_name === "string" && claims.org_name.trim()
      ? claims.org_name.trim()
      : undefined;
  const organizationName = claimedOrganizationName ?? tenantId;
  return {
    subjectId,
    tenantId,
    roles,
    scopes,
    displayName: typeof claims.name === "string" && claims.name.trim() ? claims.name : subjectId,
    organizationName,
    organizationSource: claimedOrganizationName ? "claim" : "tenant_fallback",
    authnMethod: "jwt-hs256",
    ...(typeof claims.sid === "string" ? { sessionId: claims.sid } : {}),
  };
}

export function isDemoMode() {
  return process.env.NODE_ENV !== "production" && process.env.DEMO_MODE !== "false";
}

export function validateAuthEnv() {
  if (!isDemoMode() && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)) throw new Error("AUTH_SECRET_REQUIRED_IN_PRODUCTION");
}

export function authenticate(headers: IncomingHttpHeaders): AuthContext {
  const authorization = String(headers.authorization ?? "");
  if (authorization.startsWith("Bearer ")) return verifyJwt(authorization.slice(7).trim());
  if (!isDemoMode()) throw new AuthError("auth_required");
  const actor = String(headers["x-actor"] ?? "").trim() || "viewer";
  const demo = DEMO_ACTORS[actor];
  if (!demo) throw new AuthError("auth_required");
  const tenantId = String(headers["x-tenant-id"] ?? "demo-manufacturing").trim();
  if (!tenantId) throw new AuthError("auth_required");
  return {
    ...demo,
    tenantId,
    scopes: ["*"],
    displayName: demo.displayName,
    organizationName: demoOrganizationName(tenantId),
    organizationSource: "demo",
    authnMethod: "demo-header",
    ...(actor === "viewer" ? {} : { sessionId: `demo-session:${actor}` }),
  };
}

export function assertTenant(context: AuthContext, tenantId: string) {
  if (context.tenantId !== tenantId) throw new AuthError("tenant_forbidden", 403);
}

export function assertScope(context: AuthContext, scope: string) {
  if (!context.scopes.includes("*") && !context.scopes.includes(scope)) throw new AuthError("scope_forbidden", 403);
}

export function assertRole(context: AuthContext, roles: string[]) {
  if (!roles.some((role) => context.roles.includes(role))) throw new AuthError("scope_forbidden", 403);
}

export function isReadOnlyPrincipal(context: Pick<AuthContext, "roles">) {
  return context.roles.length === 0 || context.roles.every((role) => role === READ_ONLY_ROLE);
}
