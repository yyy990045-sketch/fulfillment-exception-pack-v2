import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContestSet, buildGoldSet } from "./gold-set/cases.js";
import type { ActionType } from "./types.js";
import { evaluateAll } from "./eval/run.js";
import { approve, execute, ingest, openCase, propose, reviewConflicts, submitForApproval, verifyAndClose } from "./case/runtime.js";
import type { ConflictReviewInput } from "./case/runtime.js";
import { getCase, listCapabilityReceipts, recordCapabilityReceipt, saveCase } from "./store.js";
import type { GoldCase } from "./types.js";
import { buildReport } from "./report/build.js";
import { buildV2WorkbenchView } from "./application/v2-workbench.js";
import { buildDemoWorkspaceProjection } from "./application/demo-workspaces.js";
import { buildOperationalAnalytics, OperationalAnalyticsError } from "./analytics/index.js";
import {
  DecisionAiError,
  decisionValidationErrorCode,
  generateDecisionRecommendation,
  getDecisionRecommendation,
  listDecisionRecommendationDispositions,
  listDecisionRecommendations,
  recordDecisionRecommendationDisposition,
  resolveDecisionRecommendationProvider,
} from "./ai/decision/index.js";
import {
  RootCauseAiError,
  generateRootCauseAnalysis,
  getRootCauseAnalysis,
  listRootCauseAnalyses,
  listRootCauseHypothesisReviews,
  recordRootCauseHypothesisReview,
  resolveRootCauseProvider,
  rootCauseValidationErrorCode,
} from "./ai/root-cause/index.js";
import { evaluateDecisionPolicy, getPolicyEvaluation, listPolicyEvaluations, PolicyError, type PolicyCandidateInput } from "./policy/index.js";
import {
  AutomationError,
  buildAutomationReadiness,
  executePolicyAutomation,
  getAutomationRun,
  listAutomationRuns,
} from "./automation/index.js";
import {
  OutcomeError,
  evaluateOutcome,
  getOutcomeEvaluation,
  listOutcomeEvaluations,
} from "./outcomes/index.js";
import {
  SolutionPackError,
  bootstrapPackContextBindings,
  buildPackWorkbenchView,
  installSolutionPack,
  presentBoundContexts,
  presentSupportedActions,
  registerBuiltInSolutionPacks,
  solutionPackRegistry,
} from "./solution-packs/index.js";
import {
  ConnectorError,
  connectorRegistry,
  enqueueInternalWorkItemDelivery,
  getConnectorDeliveryView,
  installConnector,
  registerBuiltInConnectors,
  requireConnector,
} from "./connectors/index.js";
import {
  isPowerBiConfigured,
  PowerBiError,
  resolvePowerBiEmbedConfig,
} from "./integrations/powerbi/index.js";
import {
  loadSupersetConfig,
  resolveSupersetGuestToken,
  SupersetError,
} from "./integrations/superset/index.js";
import { assertRole, assertScope, assertTenant, authenticate, AuthError, isDemoMode, validateAuthEnv, type AuthContext } from "./auth.js";
import { effectiveScopes, isReadOnlyPrincipal } from "./auth.js";
import { buildIdentityCapabilities } from "./security/capabilities.js";
import { recordSecurityAudit } from "./security/audit.js";
import { createLogger } from "./ops/logger.js";
import {
  REQUEST_ID_HEADER,
  annotateRequestContext,
  currentRequestContext,
  isSafeRequestId,
  runWithRequestContext,
} from "./ops/request-context.js";
import { assertStartupSafety } from "./ops/startup.js";
import { buildOpsStatus, evaluateReadiness } from "./ops/readiness.js";
import { resolveDatabasePaths } from "./ops/db-path.js";
import { defaultUnsStreamPath, evaluateTraceabilityGate } from "./traceability/index.js";
import { buildJudgeManifest, JUDGE_CONTRACT_ARTIFACT, openExistingJudgeStore, readExecutionReadbackArtifact, readJudgeContractArtifact, resolveJudgeContextId } from "./demo/judge/index.js";
import {
  RESOLUTION_APPROVER_ROLES,
  RESOLUTION_OWNER_ROLES,
  isAssignableOwnerRole,
} from "./authorization.js";
import { EvidenceSourceError, resolveEvidenceSource } from "./evidence/endpoints.js";
import { EvidenceError, parseCsv } from "./evidence/extract.js";
import {
  acceptExceptionForResolution,
  approveResolutionCase,
  buildResolutionCapabilities,
  canAcceptResolution,
  canApproveResolution,
  canCloseResolution,
  canExecuteResolution,
  canProposeResolution,
  canReviewResolution,
  canSubmitResolution,
  closeResolutionCase,
  evaluateContextRules,
  executeResolutionCase,
  openV2SqliteDatabase,
  proposeResolutionCase,
  queryResolutionCase,
  reviewResolution,
  submitResolutionCase,
  V2SqliteStore,
  type ResolutionActionInput,
  type V2Exception,
} from "./domain/v2/index.js";
import {
  GroundedAiError,
  generateGroundedExplanation,
  getGroundedExplanation,
  groundingValidationErrorCode,
  listGroundedExplanations,
  resolveGroundedAiProvider,
} from "./ai/grounded/index.js";

const contestSet = buildContestSet();
const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = resolve(ROOT, "..", "frontend", "dist");
const caseMutationQueues = new Map<string, Promise<void>>();
let v2Store: V2SqliteStore | undefined;
let v2StoreDatabase: import("node:sqlite").DatabaseSync | undefined;
const opsLogger = createLogger();
const APP_STARTED_AT = new Date();
let inFlightRequests = 0;
let shuttingDown = false;
registerBuiltInSolutionPacks();
registerBuiltInConnectors();

function getV2Store() {
  if (!v2Store) {
    const opened = openV2SqliteDatabase();
    v2StoreDatabase = opened.database as import("node:sqlite").DatabaseSync;
    v2Store = new V2SqliteStore(opened.database);
    registerBuiltInSolutionPacks();
    bootstrapPackContextBindings(v2Store);
  }
  return v2Store;
}

function storeDatabase() {
  if (!v2Store) return undefined;
  return v2StoreDatabase;
}

/**
 * 原始载荷留存路径（回源闸门用它重算 rawHash）。
 *
 * 默认指向 judge demo 工作区；可用 JUDGE_UNS_STREAM 指向真实部署里保存的原始响应/对象存储清单。
 * 拿不到载荷时闸门一律 fail-closed，不会把"未检查"当成"已验证"。
 */
function resolveTraceabilityStreamPath() {
  const configured = process.env.JUDGE_UNS_STREAM?.trim();
  return configured ? resolve(configured) : defaultUnsStreamPath();
}

/** 执行回读产物路径（judge demo 写入；缺失时 judge manifest 显示 not_started）。 */
function resolveReadbackArtifactPath() {
  const configured = process.env.JUDGE_READBACK_ARTIFACT?.trim();
  return configured ? resolve(configured) : join(dirname(resolveTraceabilityStreamPath()), "execution-readback.json");
}

function exceptionListItem(store: V2SqliteStore, tenantId: string, exception: V2Exception) {
  const definition = store.getRuleDefinition(tenantId, exception.ruleId);
  const version = store.getRuleVersionById(tenantId, exception.ruleVersionId)
    ?? store.listActiveRuleVersions(tenantId).find((item) => item.ruleId === exception.ruleId);
  const bundle = store.getExceptionEvidenceBundle(tenantId, exception.id);
  return {
    id: exception.id,
    code: exception.code,
    exceptionType: exception.code,
    status: exception.status,
    severity: exception.severity,
    rule: {
      id: definition?.id ?? exception.ruleId,
      code: definition?.code ?? exception.ruleId,
      version: version?.version ?? exception.ruleVersionId,
    },
    title: exception.title,
    summary: exception.summary,
    metrics: exception.metrics,
    matchKey: exception.matchKey,
    createdAt: exception.createdAt,
    lastDetectedAt: exception.lastDetectedAt,
    evidenceBundleSummary: {
      evidenceCount: bundle?.evidenceIds.length ?? exception.evidenceIds.length,
      sourceSystemCount: bundle?.sourceSystems.length ?? 0,
    },
  };
}

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

async function serializeCaseMutation<T>(tenantId: string, caseId: string, mutation: () => Promise<T> | T): Promise<T> {
  const key = `${tenantId}:${caseId}`;
  const previous = caseMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  caseMutationQueues.set(key, queued);
  await previous;
  try {
    return await mutation();
  } finally {
    release();
    if (caseMutationQueues.get(key) === queued) caseMutationQueues.delete(key);
  }
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function jsonNoStore(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function contentTypeFor(filePath: string) {
  switch (extname(filePath)) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function serveFile(res: import("node:http").ServerResponse, filePath: string) {
  res.writeHead(200, { "content-type": contentTypeFor(filePath), "cache-control": "no-store" });
  res.end(readFileSync(filePath));
}

function serveManufacturing(res: import("node:http").ServerResponse, pathname: string) {
  const frontendIndex = join(FRONTEND_DIST, "index.html");
  if (existsSync(frontendIndex)) {
    const relative = pathname === "/manufacturing" || pathname === "/manufacturing/"
      ? "index.html"
      : pathname.slice("/manufacturing/".length);
    const requested = resolve(FRONTEND_DIST, relative);
    const insideDist = requested === frontendIndex || requested.startsWith(`${FRONTEND_DIST}${sep}`);
    if (insideDist && existsSync(requested) && statSync(requested).isFile()) {
      serveFile(res, requested);
      return;
    }
    serveFile(res, frontendIndex);
    return;
  }

  const legacyPath = pathname === "/manufacturing" || pathname === "/manufacturing/" || pathname.startsWith("/manufacturing/")
    ? pathname === "/manufacturing/styles.css"
      ? "styles.css"
      : pathname === "/manufacturing/app.js"
        ? "app.js"
        : "index.html"
    : "index.html";
  const legacy = readFileSync(join(ROOT, "workbench", "manufacturing", legacyPath), "utf8");
  res.writeHead(200, { "content-type": legacyPath.endsWith(".css") ? "text/css; charset=utf-8" : legacyPath.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(legacy);
}

function serveFrontendSurface(res: import("node:http").ServerResponse) {
  const frontendIndex = join(FRONTEND_DIST, "index.html");
  if (existsSync(frontendIndex)) {
    serveFile(res, frontendIndex);
    return true;
  }
  return false;
}

function tenantOf(req: import("node:http").IncomingMessage) {
  return authenticate(req.headers).tenantId;
}

function requireActor(req: import("node:http").IncomingMessage) {
  return requireMutationAuth(req).displayName;
}

function requireMutationAuth(req: import("node:http").IncomingMessage): AuthContext {
  const raw = String(req.headers["x-actor"] || "").trim();
  if (isDemoMode() && !raw && !req.headers.authorization) throw new HttpError(401, "actor_required");
  const auth = authOf(req);
  if (isReadOnlyPrincipal(auth)) throw new HttpError(403, "read_only_principal");
  return auth;
}

/**
 * mutation 统一闸门顺序：authenticate → scope → (demo actor / 只读主体检查)。
 * 之后的 tenant / workflow / policy 由各 handler 继续把关。
 */
function mutationAuth(req: import("node:http").IncomingMessage, scope: string): AuthContext {
  const auth = authOf(req);
  assertScope(auth, scope);
  return requireMutationAuth(req);
}

function assertResolutionPermission(decision: { applicable: boolean; allowed: boolean; reasonCode: string }) {
  if (decision.allowed) return;
  if (!decision.applicable) {
    throw new HttpError(409, "ACTION_NOT_APPLICABLE");
  }
  if (decision.reasonCode === "SEGREGATION_OF_DUTIES_VIOLATION") {
    throw new HttpError(409, decision.reasonCode);
  }
  if (decision.reasonCode === "APPROVAL_SUBJECT_IDENTITY_REQUIRED") {
    throw new HttpError(409, decision.reasonCode);
  }
  if (decision.reasonCode === "RECEIPT_REQUIRED") {
    throw new HttpError(409, "receipt_required");
  }
  throw new HttpError(403, decision.reasonCode);
}

function authOf(req: import("node:http").IncomingMessage): AuthContext {
  const auth = authenticate(req.headers);
  // 把身份写回请求上下文，供结构化日志与安全审计复用同一个 requestId
  annotateRequestContext({ tenantId: auth.tenantId, subjectId: auth.subjectId, roles: auth.roles });
  return auth;
}

function currentActorProjection(auth: AuthContext) {
  return {
    tenantId: auth.tenantId,
    organization: auth.organizationName,
    organizationSource: auth.organizationSource,
    user: auth.displayName,
    subjectId: auth.subjectId,
    roles: auth.roles,
    authnMethod: auth.authnMethod,
  };
}

function authorizeCase(req: import("node:http").IncomingMessage, g: GoldCase) {
  const auth = authOf(req);
  assertTenant(auth, g.tenantId);
  assertScope(auth, g.scope);
  return auth;
}

function assertEndpointAllowed(rawUrl: string) {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new HttpError(422, "invalid_evidence_endpoint"); }
  const allowlist = (process.env.EVIDENCE_ENDPOINT_ALLOWLIST || "127.0.0.1,localhost").split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowlist.includes(parsed.hostname)) throw new HttpError(403, "evidence_endpoint_forbidden");
  if (!isDemoMode() && parsed.protocol !== "https:") throw new HttpError(422, "evidence_endpoint_requires_https");
}

function gold(id: string): GoldCase {
  const found = contestSet.find((c) => c.id === id);
  if (!found) throw new Error("not_found");
  return found;
}

function ensure(tenantId: string, id: string) {
  const existing = getCase(tenantId, id);
  if (existing) return existing;
  const initial = initialCase(tenantId, id);
  return saveCase(tenantId, initial);
}

function initialCase(tenantId: string, id: string) {
  const g = gold(id);
  if (g.tenantId !== tenantId) throw new EvidenceError("CROSS_TENANT_SOURCE", `CROSS_TENANT_SOURCE:${g.id}`);
  return ingest(g, openCase(g), { tenantId, scope: g.scope });
}

function readCase(tenantId: string, id: string) {
  return getCase(tenantId, id) ?? initialCase(tenantId, id);
}

function publicGold(g: GoldCase, tenantId: string) {
  const { materials: _materials, expectedFacts: _expectedFacts, expectedConflicts: _expectedConflicts, expectedGaps: _expectedGaps, expectedActionTypes: _expectedActionTypes, negatives: _negatives, ...safe } = g;
  return { ...safe, tenantId, materials: [] };
}

async function mutateCase<T>(tenantId: string, caseId: string, mutation: (current: ReturnType<typeof ensure>) => T): Promise<T> {
  return serializeCaseMutation(tenantId, caseId, () => {
    const current = ensure(tenantId, caseId);
    return mutation(current);
  });
}

function capabilitySnapshot(module: string, tenantId: string, goldCase: GoldCase, current: ReturnType<typeof ensure>) {
  const pack = current.pack || { evidence: [], conflicts: [], gaps: [] };
  const issueCount = ("conflictIssues" in pack ? pack.conflictIssues?.length : undefined) ?? pack.conflicts.length;
  const fulfillmentRows = contestSet.filter((candidate) => candidate.pack === "fulfillment").map((candidate) => ({ id: candidate.id, status: getCase(tenantId, candidate.id)?.status ?? "new" }));
  const counts = {
    waiting: fulfillmentRows.filter((row) => ["new", "triaged", "confirmed"].includes(row.status)).length,
    inProgress: fulfillmentRows.filter((row) => ["proposed", "approved", "executed", "verified"].includes(row.status)).length,
    closed: fulfillmentRows.filter((row) => row.status === "closed").length,
  };
  if (module === "monitor") return { module, caseId: goldCase.id, counts, risk: pack.gaps.length ? "材料不足，暂不放行" : pack.conflicts.length ? "有差异，等待核对" : "材料一致，可以放行", replay: current.events.slice(-8).reverse() };
  if (module === "ontology") return { module, caseId: goldCase.id, evidenceCount: pack.evidence.length, conflictIssueCount: issueCount, entities: ["报价单", "订单", "回款记录", "客诉记录"], relations: pack.conflicts.map((conflict) => ({ field: conflict.field, left: conflict.leftValue, right: conflict.rightValue })) };
  if (module === "adjudication") return { module, caseId: goldCase.id, conflictCount: issueCount, report: buildReport(goldCase, current), decisions: ["accept", "supplement", "reject"] };
  if (module === "sandbox") return { module, caseId: goldCase.id, scenarios: [{ id: "evidence", next: "补齐订单或变更单后再确认" }, { id: "claim", next: "按订单与回款核对索赔" }, { id: "hold", next: "保持待核对，不产生执行回执" }] };
  if (module === "actions") return { module, caseId: goldCase.id, actions: current.actions, next: current.actions.length ? "检查每项动作是否都有结果" : "先从差异中生成处理方案" };
  if (module === "more") return { module, caseId: goldCase.id, capabilities: ["来源版本对照", "人工复核队列", "效果回写", "权限与审计"], records: current.capabilityRecords ?? [] };
  return { module: "workbench", caseId: goldCase.id, status: current.status, evidenceCount: pack.evidence.length, conflictCount: issueCount };
}

const MAX_BODY_BYTES = 1024 * 1024;

function readJson(req: import("node:http").IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        body = "";
        if (!settled) { settled = true; reject(new HttpError(413, "payload_too_large")); }
        return;
      }
      body += String(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      try { resolve(body ? JSON.parse(body) : {}); } catch { settled = true; reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}

const handleRequest = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    const legacyManufacturingFile = req.method === "GET"
      ? (
        url.pathname === "/manufacturing-legacy" || url.pathname === "/manufacturing-legacy/"
          ? { path: "index.html", contentType: "text/html; charset=utf-8" }
          : url.pathname === "/manufacturing-legacy/styles.css"
            ? { path: "styles.css", contentType: "text/css; charset=utf-8" }
            : url.pathname === "/manufacturing-legacy/app.js"
              ? { path: "app.js", contentType: "text/javascript; charset=utf-8" }
              : undefined
      )
      : undefined;
    if (legacyManufacturingFile) {
      let body = readFileSync(join(ROOT, "workbench", "manufacturing", legacyManufacturingFile.path), "utf8");
      if (legacyManufacturingFile.path === "index.html") {
        body = body
          .replaceAll("/manufacturing/styles.css", "/manufacturing-legacy/styles.css")
          .replaceAll("/manufacturing/app.js", "/manufacturing-legacy/app.js");
      }
      res.writeHead(200, { "content-type": legacyManufacturingFile.contentType, "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (req.method === "GET" && (url.pathname === "/frontend" || url.pathname === "/frontend/" || url.pathname.startsWith("/frontend/"))) {
      if (serveFrontendSurface(res)) return;
    }
    if (req.method === "GET" && (url.pathname === "/manufacturing" || url.pathname === "/manufacturing/" || url.pathname.startsWith("/manufacturing/"))) {
      serveManufacturing(res, url.pathname);
      return;
    }
    if (
      req.method === "GET" &&
      (
        url.pathname === "/operations" ||
        url.pathname === "/operations/" ||
        url.pathname === "/demo/judge" ||
        url.pathname === "/demo/judge/" ||
        url.pathname === "/analytics" ||
        url.pathname === "/analytics/" ||
        url.pathname === "/workspace" ||
        url.pathname.startsWith("/workspace/") ||
        url.pathname === "/manufacturing/analytics" ||
        url.pathname === "/manufacturing/analytics/"
      )
    ) {
      if (serveFrontendSurface(res)) return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      const html = readFileSync(join(ROOT, "workbench", "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true });
    // readiness：只反映服务自身与「显式 required」的集成；未配置的外部集成不影响就绪。
    if (req.method === "GET" && url.pathname === "/api/ready") {
      let database: ReturnType<typeof storeDatabase>;
      try { getV2Store(); database = storeDatabase(); } catch { database = undefined; }
      const readiness = evaluateReadiness({ db: database, databasePath: resolveDatabasePaths(process.env).file });
      return jsonNoStore(res, readiness.ready ? 200 : 503, {
        ready: readiness.ready,
        checks: readiness.checks,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/ops/status") {
      const auth = authOf(req);
      assertScope(auth, "admin:tenant");
      let database: ReturnType<typeof storeDatabase>;
      try { getV2Store(); database = storeDatabase(); } catch { database = undefined; }
      return jsonNoStore(res, 200, buildOpsStatus({
        db: database,
        databasePath: resolveDatabasePaths(process.env).file,
        uptimeSeconds: process.uptime(),
        startedAt: APP_STARTED_AT.toISOString(),
      }));
    }
    if (req.method === "GET" && url.pathname === "/api/v2/auth/context") {
      const auth = authOf(req);
      return json(res, 200, {
        currentActor: currentActorProjection(auth),
        ...(auth.authnMethod === "demo-header" && isDemoMode()
          ? { demoWorkspace: buildDemoWorkspaceProjection(getV2Store()) }
          : {}),
      });
    }
    // 统一身份与能力投影：前端只消费这里的结果，不自行推断 canApprove/canSubmit/canExecute。
    if (req.method === "GET" && url.pathname === "/api/v2/auth/me") {
      const auth = authOf(req);
      const resolved = effectiveScopes(auth);
      return jsonNoStore(res, 200, {
        subjectId: auth.subjectId,
        tenantId: auth.tenantId,
        displayName: auth.displayName,
        organization: auth.organizationName,
        organizationSource: auth.organizationSource,
        authnMethod: auth.authnMethod,
        roles: auth.roles,
        canonicalRoles: resolved.canonicalRoles,
        scopes: auth.scopes.includes("*") ? ["*"] : resolved.scopes,
        capabilities: buildIdentityCapabilities(auth),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/analytics/operational") {
      const auth = authOf(req);
      assertScope(auth, "analytics:read");
      const tenantId = auth.tenantId;
      const analytics = buildOperationalAnalytics(getV2Store(), tenantId, {
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        timeBasis: (url.searchParams.get("timeBasis") as "context_opened" | "exception_occurrence" | null) ?? undefined,
        bucket: (url.searchParams.get("bucket") as "day" | "week" | "month" | null) ?? undefined,
        contextType: url.searchParams.get("contextType") ?? undefined,
        exceptionCode: url.searchParams.get("exceptionCode") ?? undefined,
        severity: (url.searchParams.get("severity") as "low" | "medium" | "high" | "critical" | null) ?? undefined,
        resolutionStatus: (url.searchParams.get("resolutionStatus") as "no_case" | "triaged" | "confirmed" | "proposed_draft" | "pending_approval" | "approved" | "executed" | "closed" | "rejected" | null) ?? undefined,
        // 工业维度（可选）：site / line / sourceSystem
        site: url.searchParams.get("site") ?? undefined,
        line: url.searchParams.get("line") ?? undefined,
        sourceSystem: url.searchParams.get("sourceSystem") ?? undefined,
      });
      return json(res, 200, analytics);
    }
    if (req.method === "GET" && url.pathname === "/api/v2/analytics/powerbi/embed-config") {
      const auth = authOf(req);
      assertScope(auth, "analytics:read");
      return jsonNoStore(res, 200, await resolvePowerBiEmbedConfig(auth));
    }
    if (req.method === "GET" && url.pathname === "/api/v2/analytics/providers") {
      const auth = authOf(req);
      assertScope(auth, "analytics:read");
      const superset = loadSupersetConfig();
      const powerbi = isPowerBiConfigured();
      return json(res, 200, {
        providers: {
          superset: superset
            ? { configured: true, dashboardId: superset.dashboardId, supersetDomain: superset.domain }
            : { configured: false },
          powerbi: { configured: powerbi },
        },
        defaultProvider: superset ? "superset" : powerbi ? "powerbi" : null,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/analytics/superset/guest-token") {
      const auth = authOf(req);
      assertScope(auth, "analytics:read");
      return jsonNoStore(res, 200, await resolveSupersetGuestToken(auth));
    }
    if (req.method === "GET" && url.pathname === "/api/v2/outcome-definitions") {
      const auth = authOf(req);
      assertScope(auth, "context:read");
      const tenantId = auth.tenantId;
      const exceptionCode = url.searchParams.get("exceptionCode") ?? undefined;
      return json(res, 200, {
        definitions: getV2Store().listOutcomeDefinitions(tenantId, exceptionCode, false),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/solution-packs") {
      assertScope(authOf(req), "solution-pack:read");
      return json(res, 200, {
        packs: solutionPackRegistry.list().map((pack) => ({
          manifest: pack.manifest,
          installed: Boolean(getV2Store().getSolutionPackInstallation(authOf(req).tenantId, pack.manifest.id)),
          supportedActions: presentSupportedActions(pack),
        })),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/connectors") {
      assertScope(authOf(req), "connector:read");
      return json(res, 200, { connectors: connectorRegistry.list() });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/connectors/installed") {
      const auth = authOf(req);
      assertScope(auth, "connector:read");
      const tenantId = auth.tenantId;
      return json(res, 200, {
        installations: getV2Store().listConnectorInstallations(tenantId).map((installation) => ({
          installation: {
            ...installation,
            secretConfigured: Boolean(installation.secretRef),
            secretRef: undefined,
          },
          manifest: connectorRegistry.get(installation.connectorId)?.manifest ?? null,
        })),
      });
    }
    const connectorInstallMatch = url.pathname.match(/^\/api\/v2\/connectors\/([^/]+)\/install$/);
    if (req.method === "POST" && connectorInstallMatch) {
      const auth = authOf(req);
      assertScope(auth, "connector:manage");
      const connectorId = decodeURIComponent(connectorInstallMatch[1] ?? "");
      const connector = requireConnector(connectorRegistry.get(connectorId));
      const actor = requireActor(req);
      const input = await readJson(req);
      const forbidden = Object.keys(input).filter((key) => ["actor", "roles", "tenant", "tenantId"].includes(key));
      if (forbidden.length) return json(res, 400, { error: "CONNECTOR_INSTALL_FIELDS_FORBIDDEN" });
      if (typeof input.installationId !== "string" || !input.installationId.trim()) return json(res, 422, { error: "CONNECTOR_INSTALLATION_ID_REQUIRED" });
      const installation = installConnector(getV2Store(), connector, {
        tenantId: auth.tenantId,
        installationId: input.installationId,
        config: input.config && typeof input.config === "object" && !Array.isArray(input.config) ? input.config as Record<string, unknown> : {},
        ...(typeof input.secretRef === "string" ? { secretRef: input.secretRef } : {}),
        actor,
      });
      recordSecurityAudit(getV2Store(), {
        auth,
        action: "connector.install",
        resourceType: "connector_installation",
        resourceId: installation.id,
        result: "success",
        metadata: { connectorId, installationId: installation.id },
      });
      return json(res, 200, {
        installation: { ...installation, secretConfigured: Boolean(installation.secretRef), secretRef: undefined },
        manifest: connector.manifest,
      });
    }
    const connectorOutboxAttemptsMatch = url.pathname.match(/^\/api\/v2\/connectors\/outbox\/([^/]+)\/attempts$/);
    if (req.method === "GET" && connectorOutboxAttemptsMatch) {
      const auth = authOf(req);
      assertScope(auth, "connector:read");
      const tenantId = auth.tenantId;
      const outboxId = decodeURIComponent(connectorOutboxAttemptsMatch[1] ?? "");
      const outbox = getV2Store().getConnectorOutbox(tenantId, outboxId);
      if (!outbox) return json(res, 404, { error: "not_found" });
      return json(res, 200, { outboxId, attempts: getV2Store().listConnectorDeliveryAttempts(tenantId, outboxId) });
    }
    const connectorOutboxMatch = url.pathname.match(/^\/api\/v2\/connectors\/outbox\/([^/]+)$/);
    if (req.method === "GET" && connectorOutboxMatch) {
      const auth = authOf(req);
      assertScope(auth, "connector:read");
      const view = getConnectorDeliveryView(getV2Store(), auth.tenantId, decodeURIComponent(connectorOutboxMatch[1] ?? ""));
      if (!view) return json(res, 404, { error: "not_found" });
      return json(res, 200, view);
    }
    const workItemDeliveryMatch = url.pathname.match(/^\/api\/v2\/internal-work-items\/([^/]+)\/deliveries$/);
    if (workItemDeliveryMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      const tenantId = auth.tenantId;
      const workItemId = decodeURIComponent(workItemDeliveryMatch[1] ?? "");
      const store = getV2Store();
      const workItem = store.getInternalWorkItem(tenantId, workItemId);
      if (!workItem) return json(res, 404, { error: "not_found" });
      if (req.method === "GET") {
        assertScope(auth, "execution:read");
        return json(res, 200, {
          workItemId,
          deliveries: store.listConnectorOutboxByWorkItem(tenantId, workItemId).map((item) => getConnectorDeliveryView(store, tenantId, item.id)),
        });
      }
      const deliveryAuth = mutationAuth(req, "execution:run");
      const input = await readJson(req);
      const forbidden = Object.keys(input).filter((key) => key !== "connectorInstallationId");
      if (forbidden.length) return json(res, 400, { error: "CONNECTOR_DELIVERY_FIELDS_FORBIDDEN" });
      if (typeof input.connectorInstallationId !== "string" || !input.connectorInstallationId.trim()) return json(res, 422, { error: "CONNECTOR_INSTALLATION_ID_REQUIRED" });
      const outbox = enqueueInternalWorkItemDelivery(store, tenantId, workItemId, input.connectorInstallationId);
      recordSecurityAudit(store, {
        auth: deliveryAuth,
        action: "internal_work_item.deliver",
        resourceType: "connector_outbox",
        resourceId: outbox.id,
        result: "accepted",
        metadata: { workItemId, outboxId: outbox.id, installationId: input.connectorInstallationId },
      });
      return json(res, 202, getConnectorDeliveryView(store, tenantId, outbox.id));
    }
    if (req.method === "GET" && url.pathname === "/api/v2/solution-packs/installed") {
      const auth = authOf(req);
      assertScope(auth, "solution-pack:read");
      const tenantId = auth.tenantId;
      const store = getV2Store();
      return json(res, 200, {
        installations: store.listSolutionPackInstallations(tenantId).map((installation) => {
          const pack = solutionPackRegistry.get(installation.packId);
          return {
          installation,
          manifest: pack?.manifest ?? null,
          supportedActions: pack ? presentSupportedActions(pack) : [],
          boundContexts: pack ? presentBoundContexts(store, tenantId, installation.packId) : [],
          };
        }),
      });
    }
    const packInstallMatch = url.pathname.match(/^\/api\/v2\/solution-packs\/([^/]+)\/install$/);
    if (req.method === "POST" && packInstallMatch) {
      const auth = authOf(req);
      assertScope(auth, "solution-pack:manage");
      const packId = decodeURIComponent(packInstallMatch[1] ?? "");
      const pack = solutionPackRegistry.get(packId);
      if (!pack) return json(res, 404, { error: "PACK_NOT_FOUND" });
      const actor = requireActor(req);
      const input = await readJson(req);
      const forbidden = Object.keys(input).filter((key) => ["actor", "roles", "tenant", "tenantId"].includes(key));
      if (forbidden.length) return json(res, 400, { error: "PACK_INSTALL_FIELDS_FORBIDDEN" });
      const installation = installSolutionPack(getV2Store(), pack, authOf(req).tenantId, actor, input);
      recordSecurityAudit(getV2Store(), {
        auth,
        action: "solution_pack.install",
        resourceType: "solution_pack_installation",
        resourceId: packId,
        result: "success",
        metadata: { packId },
      });
      return json(res, 200, { installation, manifest: pack.manifest, supportedActions: presentSupportedActions(pack) });
    }
    const packDetailMatch = url.pathname.match(/^\/api\/v2\/solution-packs\/([^/]+)$/);
    if (req.method === "GET" && packDetailMatch) {
      assertScope(authOf(req), "solution-pack:read");
      const pack = solutionPackRegistry.get(decodeURIComponent(packDetailMatch[1] ?? ""));
      if (!pack) return json(res, 404, { error: "PACK_NOT_FOUND" });
      return json(res, 200, { manifest: pack.manifest, supportedActions: presentSupportedActions(pack) });
    }
    const packWorkbenchMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/pack-workbench$/);
    if (req.method === "GET" && packWorkbenchMatch) {
      const auth = authOf(req);
      assertScope(auth, "context:read");
      const view = buildPackWorkbenchView(getV2Store(), auth.tenantId, decodeURIComponent(packWorkbenchMatch[1] ?? ""));
      if (!view) return json(res, 404, { error: "not_found" });
      return json(res, 200, view);
    }
    const outcomeEvaluationItemMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/outcome-evaluations\/([^/]+)$/);
    if (req.method === "GET" && outcomeEvaluationItemMatch) {
      assertScope(authOf(req), "governance:read");
      const evaluation = getOutcomeEvaluation(
        getV2Store(),
        authOf(req).tenantId,
        decodeURIComponent(outcomeEvaluationItemMatch[1] ?? ""),
        decodeURIComponent(outcomeEvaluationItemMatch[2] ?? ""),
        decodeURIComponent(outcomeEvaluationItemMatch[3] ?? ""),
      );
      if (!evaluation) return json(res, 404, { error: "not_found" });
      return json(res, 200, evaluation);
    }
    const outcomeEvaluationCollectionMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/outcome-evaluations$/);
    if (outcomeEvaluationCollectionMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "governance:read" : "governance:submit");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(outcomeEvaluationCollectionMatch[1] ?? "");
      const exceptionId = decodeURIComponent(outcomeEvaluationCollectionMatch[2] ?? "");
      const store = getV2Store();
      if (!store.listExceptions(tenantId, contextId).some((item) => item.id === exceptionId)) return json(res, 404, { error: "not_found" });
      if (req.method === "GET") {
        return json(res, 200, { contextId, exceptionId, evaluations: listOutcomeEvaluations(store, tenantId, contextId, exceptionId) });
      }
      const actor = requireActor(req);
      const input = await readJson(req);
      const forbidden = Object.keys(input).filter((key) => !["definitionId", "evidenceIds", "resolutionCaseId", "automationRunId"].includes(key));
      if (forbidden.length) return json(res, 400, { error: "OUTCOME_REQUEST_FIELDS_FORBIDDEN" });
      if (typeof input.definitionId !== "string" || !input.definitionId.trim()) return json(res, 422, { error: "OUTCOME_DEFINITION_ID_REQUIRED" });
      if (!Array.isArray(input.evidenceIds) || input.evidenceIds.some((item) => typeof item !== "string" || !item.trim())) {
        return json(res, 422, { error: "OUTCOME_EVIDENCE_IDS_INVALID" });
      }
      const evaluation = evaluateOutcome(store, tenantId, contextId, exceptionId, {
        definitionId: input.definitionId,
        evidenceIds: input.evidenceIds as string[],
        ...(typeof input.resolutionCaseId === "string" ? { resolutionCaseId: input.resolutionCaseId } : {}),
        ...(typeof input.automationRunId === "string" ? { automationRunId: input.automationRunId } : {}),
      }, actor);
      recordSecurityAudit(store, {
        auth,
        action: "outcome.evaluate",
        resourceType: "outcome_evaluation",
        resourceId: evaluation.id ?? exceptionId,
        result: "success",
        metadata: { contextId, exceptionId },
      });
      return json(res, 200, evaluation);
    }
    const rootCauseReviewMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/root-cause-analyses\/([^/]+)\/hypotheses\/([^/]+)\/reviews$/);
    if (rootCauseReviewMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "decision:read" : "decision:recommend");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(rootCauseReviewMatch[1] ?? "");
      const exceptionId = decodeURIComponent(rootCauseReviewMatch[2] ?? "");
      const analysisId = decodeURIComponent(rootCauseReviewMatch[3] ?? "");
      const hypothesisId = decodeURIComponent(rootCauseReviewMatch[4] ?? "");
      const store = getV2Store();
      if (req.method === "GET") {
        const analysis = getRootCauseAnalysis(store, tenantId, contextId, exceptionId, analysisId);
        if (!analysis) return json(res, 404, { error: "not_found" });
        return json(res, 200, {
          analysisId,
          hypothesisId,
          reviews: listRootCauseHypothesisReviews(store, tenantId, analysisId, hypothesisId),
        });
      }
      const actor = requireActor(req);
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined || input.actor !== undefined || input.roles !== undefined) {
        return json(res, 400, { error: "actor_and_tenant_from_auth_required" });
      }
      const decision = String(input.decision || "");
      if (!["investigate", "needs_evidence", "rejected"].includes(decision)) return json(res, 422, { error: "invalid_root_cause_review" });
      const review = recordRootCauseHypothesisReview(store, tenantId, contextId, exceptionId, analysisId, hypothesisId, {
        decision: decision as "investigate" | "needs_evidence" | "rejected",
        rationale: typeof input.rationale === "string" ? input.rationale : "",
        actor,
      });
      recordSecurityAudit(store, {
        auth,
        action: "root_cause.review",
        resourceType: "root_cause_hypothesis",
        resourceId: hypothesisId,
        result: "success",
        metadata: { contextId, exceptionId, decision },
      });
      return json(res, 200, review);
    }
    const rootCauseItemMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/root-cause-analyses\/([^/]+)$/);
    if (req.method === "GET" && rootCauseItemMatch) {
      assertScope(authOf(req), "decision:read");
      const analysis = getRootCauseAnalysis(
        getV2Store(),
        authOf(req).tenantId,
        decodeURIComponent(rootCauseItemMatch[1] ?? ""),
        decodeURIComponent(rootCauseItemMatch[2] ?? ""),
        decodeURIComponent(rootCauseItemMatch[3] ?? ""),
      );
      if (!analysis) return json(res, 404, { error: "not_found" });
      return json(res, 200, analysis);
    }
    const rootCauseCollectionMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/root-cause-analyses$/);
    if (rootCauseCollectionMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "decision:read" : "decision:recommend");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(rootCauseCollectionMatch[1] ?? "");
      const exceptionId = decodeURIComponent(rootCauseCollectionMatch[2] ?? "");
      const store = getV2Store();
      if (!store.listExceptions(tenantId, contextId).some((item) => item.id === exceptionId)) return json(res, 404, { error: "not_found" });
      if (req.method === "GET") return json(res, 200, { contextId, exceptionId, analyses: listRootCauseAnalyses(store, tenantId, contextId, exceptionId) });
      const actor = requireActor(req);
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined || input.actor !== undefined || input.roles !== undefined) {
        return json(res, 400, { error: "actor_and_tenant_from_auth_required" });
      }
      const analysis = await generateRootCauseAnalysis(store, resolveRootCauseProvider(), tenantId, contextId, exceptionId, actor);
      if (analysis.status === "rejected") {
        return json(res, 422, { error: rootCauseValidationErrorCode(analysis.validation), analysis });
      }
      recordSecurityAudit(store, {
        auth,
        action: "root_cause.generate",
        resourceType: "root_cause_analysis",
        resourceId: analysis.id ?? exceptionId,
        result: "success",
        metadata: { contextId, exceptionId },
      });
      return json(res, 200, analysis);
    }
    const policyEvaluationMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/policy-evaluations$/);
    if (policyEvaluationMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "governance:read" : "decision:recommend");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(policyEvaluationMatch[1] ?? "");
      const exceptionId = decodeURIComponent(policyEvaluationMatch[2] ?? "");
      const store = getV2Store();
      if (!store.listExceptions(tenantId, contextId).some((item) => item.id === exceptionId)) return json(res, 404, { error: "not_found" });
      if (req.method === "GET") {
        return json(res, 200, { contextId, exceptionId, evaluations: listPolicyEvaluations(store, tenantId, contextId, exceptionId) });
      }
      const actor = requireActor(req);
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined || input.actor !== undefined || input.roles !== undefined) {
        return json(res, 400, { error: "actor_and_tenant_from_auth_required" });
      }
      const candidate: PolicyCandidateInput = typeof input.actionType === "string"
        ? { actionType: input.actionType as ActionType }
        : { recommendationId: String(input.recommendationId || ""), optionId: String(input.optionId || "") };
      const evaluation = evaluateDecisionPolicy(store, tenantId, contextId, exceptionId, candidate, actor);
      recordSecurityAudit(store, {
        auth,
        action: "policy.evaluate",
        resourceType: "policy_evaluation",
        resourceId: evaluation.id ?? exceptionId,
        result: "success",
        metadata: { contextId, exceptionId },
      });
      return json(res, 200, evaluation);
    }
    const automationReadinessMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/policy-evaluations\/([^/]+)\/automation-readiness$/);
    if (req.method === "GET" && automationReadinessMatch) {
      const auth = authOf(req);
      assertScope(auth, "execution:read");
      const tenantId = auth.tenantId;
      const readiness = buildAutomationReadiness(
        getV2Store(),
        tenantId,
        decodeURIComponent(automationReadinessMatch[1] ?? ""),
        decodeURIComponent(automationReadinessMatch[2] ?? ""),
        decodeURIComponent(automationReadinessMatch[3] ?? ""),
      );
      return json(res, 200, readiness);
    }
    const automationRunItemMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/automation-runs\/([^/]+)$/);
    if (req.method === "GET" && automationRunItemMatch) {
      assertScope(authOf(req), "execution:read");
      const result = getAutomationRun(
        getV2Store(),
        authOf(req).tenantId,
        decodeURIComponent(automationRunItemMatch[1] ?? ""),
        decodeURIComponent(automationRunItemMatch[2] ?? ""),
        decodeURIComponent(automationRunItemMatch[3] ?? ""),
      );
      if (!result) return json(res, 404, { error: "not_found" });
      return json(res, 200, result);
    }
    const policyAutomationRunItemMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/policy-evaluations\/([^/]+)\/automation-runs\/([^/]+)$/);
    if (req.method === "GET" && policyAutomationRunItemMatch) {
      assertScope(authOf(req), "execution:read");
      const result = getAutomationRun(
        getV2Store(),
        authOf(req).tenantId,
        decodeURIComponent(policyAutomationRunItemMatch[1] ?? ""),
        decodeURIComponent(policyAutomationRunItemMatch[2] ?? ""),
        decodeURIComponent(policyAutomationRunItemMatch[4] ?? ""),
      );
      if (!result || result.run.policyEvaluationId !== decodeURIComponent(policyAutomationRunItemMatch[3] ?? "")) return json(res, 404, { error: "not_found" });
      return json(res, 200, result);
    }
    const automationRunCollectionMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/policy-evaluations\/([^/]+)\/automation-runs$/);
    if (automationRunCollectionMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "execution:read" : "execution:run");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(automationRunCollectionMatch[1] ?? "");
      const exceptionId = decodeURIComponent(automationRunCollectionMatch[2] ?? "");
      const policyEvaluationId = decodeURIComponent(automationRunCollectionMatch[3] ?? "");
      const store = getV2Store();
      const evaluation = getPolicyEvaluation(store, tenantId, contextId, exceptionId, policyEvaluationId);
      if (!evaluation) return json(res, 404, { error: "not_found" });
      if (req.method === "GET") {
        return json(res, 200, { contextId, exceptionId, policyEvaluationId, runs: listAutomationRuns(store, tenantId, contextId, exceptionId).filter((item) => item.run.policyEvaluationId === policyEvaluationId) });
      }
      const actor = requireActor(req);
      const input = await readJson(req);
      if (Object.keys(input).length > 0) return json(res, 400, { error: "AUTOMATION_REQUEST_FIELDS_FORBIDDEN" });
      const result = executePolicyAutomation(store, tenantId, contextId, exceptionId, policyEvaluationId, actor, "human_request");
      recordSecurityAudit(store, {
        auth,
        action: "automation.execute",
        resourceType: "automation_run",
        resourceId: result.run?.id ?? policyEvaluationId,
        result: "success",
        metadata: { contextId, exceptionId },
      });
      return json(res, 200, result);
    }
    const automationRunListMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/automation-runs$/);
    if (req.method === "GET" && automationRunListMatch) {
      const auth = authOf(req);
      assertScope(auth, "execution:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(automationRunListMatch[1] ?? "");
      const exceptionId = decodeURIComponent(automationRunListMatch[2] ?? "");
      const store = getV2Store();
      if (!store.listExceptions(tenantId, contextId).some((item) => item.id === exceptionId)) return json(res, 404, { error: "not_found" });
      return json(res, 200, { contextId, exceptionId, runs: listAutomationRuns(store, tenantId, contextId, exceptionId) });
    }
    if (req.method === "GET" && url.pathname === "/api/v2/internal-work-items") {
      assertScope(authOf(req), "execution:read");
      const status = url.searchParams.get("status") ?? undefined;
      const kind = url.searchParams.get("kind") ?? undefined;
      if (status && !["open", "completed", "cancelled"].includes(status)) return json(res, 422, { error: "AUTOMATION_WORK_ITEM_STATUS_INVALID" });
      if (kind && !["task", "evidence_request"].includes(kind)) return json(res, 422, { error: "AUTOMATION_WORK_ITEM_KIND_INVALID" });
      const items = getV2Store().listInternalWorkItems(authOf(req).tenantId, {
        status: status as "open" | "completed" | "cancelled" | undefined,
        kind: kind as "task" | "evidence_request" | undefined,
        contextId: url.searchParams.get("contextId") ?? undefined,
        exceptionId: url.searchParams.get("exceptionId") ?? undefined,
      });
      return json(res, 200, { workItems: items });
    }
    const decisionDispositionMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/decision-recommendations\/([^/]+)\/dispositions$/);
    if (decisionDispositionMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "decision:read" : "decision:recommend");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(decisionDispositionMatch[1] ?? "");
      const exceptionId = decodeURIComponent(decisionDispositionMatch[2] ?? "");
      const recommendationId = decodeURIComponent(decisionDispositionMatch[3] ?? "");
      const store = getV2Store();
      if (req.method === "GET") {
        const recommendation = getDecisionRecommendation(store, tenantId, contextId, exceptionId, recommendationId);
        if (!recommendation) return json(res, 404, { error: "not_found" });
        return json(res, 200, { recommendationId, dispositions: listDecisionRecommendationDispositions(store, tenantId, recommendationId) });
      }
      const actor = requireActor(req);
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined || input.actor !== undefined || input.roles !== undefined) {
        return json(res, 400, { error: "actor_and_tenant_from_auth_required" });
      }
      const decision = String(input.decision || "");
      if (!["accepted", "modified", "rejected"].includes(decision)) return json(res, 422, { error: "invalid_decision_disposition" });
      const disposition = recordDecisionRecommendationDisposition(store, tenantId, contextId, exceptionId, recommendationId, {
        decision: decision as "accepted" | "modified" | "rejected",
        selectedOptionId: typeof input.selectedOptionId === "string" ? input.selectedOptionId : undefined,
        rationale: typeof input.rationale === "string" ? input.rationale : "",
        actor,
      });
      recordSecurityAudit(store, {
        auth,
        action: "decision.disposition",
        resourceType: "decision_recommendation",
        resourceId: recommendationId,
        result: "success",
        metadata: { contextId, exceptionId, decision },
      });
      return json(res, 200, disposition);
    }
    const decisionItemMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/decision-recommendations\/([^/]+)$/);
    if (req.method === "GET" && decisionItemMatch) {
      const auth = authOf(req);
      assertScope(auth, "decision:read");
      const tenantId = auth.tenantId;
      const recommendation = getDecisionRecommendation(
        getV2Store(),
        tenantId,
        decodeURIComponent(decisionItemMatch[1] ?? ""),
        decodeURIComponent(decisionItemMatch[2] ?? ""),
        decodeURIComponent(decisionItemMatch[3] ?? ""),
      );
      if (!recommendation) return json(res, 404, { error: "not_found" });
      return json(res, 200, recommendation);
    }
    const decisionCollectionMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/decision-recommendations$/);
    if (decisionCollectionMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "decision:read" : "decision:recommend");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(decisionCollectionMatch[1] ?? "");
      const exceptionId = decodeURIComponent(decisionCollectionMatch[2] ?? "");
      const store = getV2Store();
      if (!store.listExceptions(tenantId, contextId).some((item) => item.id === exceptionId)) return json(res, 404, { error: "not_found" });
      if (req.method === "GET") return json(res, 200, { contextId, exceptionId, recommendations: listDecisionRecommendations(store, tenantId, contextId, exceptionId) });
      const actor = requireActor(req);
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined || input.actor !== undefined || input.roles !== undefined) {
        return json(res, 400, { error: "actor_and_tenant_from_auth_required" });
      }
      const recommendation = await generateDecisionRecommendation(store, resolveDecisionRecommendationProvider(), tenantId, contextId, exceptionId, actor);
      if (recommendation.status === "rejected") {
        return json(res, 422, { error: decisionValidationErrorCode(recommendation.validation), recommendation });
      }
      recordSecurityAudit(store, {
        auth,
        action: "decision.recommend",
        resourceType: "decision_recommendation",
        resourceId: recommendation.id ?? exceptionId,
        result: "success",
        metadata: { contextId, exceptionId },
      });
      return json(res, 200, recommendation);
    }
    const manufacturingWorkbenchMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/workbench$/);
    if (req.method === "GET" && manufacturingWorkbenchMatch) {
      const auth = authOf(req);
      assertScope(auth, "context:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(manufacturingWorkbenchMatch[1] ?? "");
      const view = buildV2WorkbenchView(getV2Store(), tenantId, contextId);
      if (!view) return json(res, 404, { error: "not_found" });
      return json(res, 200, view);
    }
    if (req.method === "GET" && url.pathname === "/api/v2/demo/judge/manifest") {
      // 比赛评委视图：现有数据的只读聚合，不新增 Dashboard、不产生新数据。
      const auth = authOf(req);
      assertScope(auth, "context:read");
      const tenantId = auth.tenantId;
      const requested = url.searchParams.get("contextId");
      const exceptionId = url.searchParams.get("exceptionId");
      const payloadSourcePath = resolveTraceabilityStreamPath();
      const judgeDatabasePath = join(dirname(payloadSourcePath), "pack-cases.sqlite");
      let judgeStoreHandle: ReturnType<typeof openExistingJudgeStore> | null = null;
      // 默认评委页必须和最近一次 demo:judge 使用同一个隔离库，避免 Contract 是新产物而证据回源落到旧业务库。
      if (!requested && existsSync(judgeDatabasePath)) {
        try {
          judgeStoreHandle = openExistingJudgeStore(judgeDatabasePath);
        } catch {
          judgeStoreHandle = null;
        }
      }
      const store = judgeStoreHandle?.store ?? getV2Store();
      const contextId = requested ?? resolveJudgeContextId(store, tenantId);
      if (!contextId) {
        judgeStoreHandle?.close();
        return json(res, 404, { error: "no_context_available" });
      }
      if (!store.getContext(tenantId, contextId)) {
        judgeStoreHandle?.close();
        return json(res, 404, { error: "not_found" });
      }
      const contractPath = join(dirname(payloadSourcePath), JUDGE_CONTRACT_ARTIFACT);
      try {
        return json(res, 200, buildJudgeManifest({
          store,
          tenantId,
          contextId,
          exceptionId,
          payloadSourcePath,
          readback: readExecutionReadbackArtifact(resolveReadbackArtifactPath()),
          contract: readJudgeContractArtifact(contractPath),
        }));
      } finally {
        judgeStoreHandle?.close();
      }
    }
    if (req.method === "GET" && url.pathname === "/api/cases") {
      const auth = authOf(req);
      const tenantId = auth.tenantId;
      return json(
        res,
        200,
        contestSet
          .filter((c) => c.tenantId === tenantId && (auth.scopes.includes("*") || auth.scopes.includes(c.scope)))
          .map((c) => ({ id: c.id, title: c.title, pack: c.pack, ownerRole: c.ownerRole, status: getCase(tenantId, c.id)?.status ?? "new" })),
      );
    }
    const v2ReplayMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/replay$/);
    if (req.method === "GET" && v2ReplayMatch) {
      const auth = authOf(req);
      assertScope(auth, "context:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2ReplayMatch[1] ?? "");
      const store = getV2Store();
      const replay = store.replayContext(tenantId, contextId);
      if (!replay.context) return json(res, 404, { error: "not_found" });
      return json(res, 200, replay);
    }
    const v2ExceptionsMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions$/);
    if (req.method === "GET" && v2ExceptionsMatch) {
      const auth = authOf(req);
      assertScope(auth, "exception:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2ExceptionsMatch[1] ?? "");
      const store = getV2Store();
      const replay = store.replayContext(tenantId, contextId);
      if (!replay.context) return json(res, 404, { error: "not_found" });
      const exceptions = store.listExceptions(tenantId, contextId).map((exception) => exceptionListItem(store, tenantId, exception));
      return json(res, 200, { contextId, exceptions });
    }
    const v2EvaluationRunMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/evaluations\/run$/);
    if (req.method === "POST" && v2EvaluationRunMatch) {
      const auth = mutationAuth(req, "governance:submit");
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined) return json(res, 400, { error: "tenant_from_auth_required" });
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2EvaluationRunMatch[1] ?? "");
      const result = evaluateContextRules(getV2Store(), tenantId, contextId);
      if (!result) return json(res, 404, { error: "not_found" });
      recordSecurityAudit(getV2Store(), {
        auth,
        action: "rule.evaluate",
        resourceType: "fulfillment_context",
        resourceId: contextId,
        result: "success",
        metadata: { contextId, actionCount: result.exceptions.length },
      });
      return json(res, 200, {
        contextId,
        evaluations: result.evaluations,
        exceptions: result.exceptions.map((exception) => exceptionListItem(getV2Store(), tenantId, exception)),
      });
    }
    const v2EvaluationsMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/rule-evaluations$/);
    if (req.method === "GET" && v2EvaluationsMatch) {
      const auth = authOf(req);
      assertScope(auth, "exception:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2EvaluationsMatch[1] ?? "");
      const store = getV2Store();
      if (!store.getContext(tenantId, contextId)) return json(res, 404, { error: "not_found" });
      return json(res, 200, { contextId, evaluations: store.listRuleEvaluations(tenantId, contextId) });
    }
    const v2ExplanationItemMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/explanations\/([^/]+)$/);
    if (req.method === "GET" && v2ExplanationItemMatch) {
      const auth = authOf(req);
      assertScope(auth, "evidence:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2ExplanationItemMatch[1] ?? "");
      const exceptionId = decodeURIComponent(v2ExplanationItemMatch[2] ?? "");
      const explanationId = decodeURIComponent(v2ExplanationItemMatch[3] ?? "");
      const store = getV2Store();
      const explanation = getGroundedExplanation(store, tenantId, contextId, exceptionId, explanationId);
      if (!explanation) return json(res, 404, { error: "not_found" });
      return json(res, 200, { explanation, stale: explanation.stale });
    }
    const v2ExplanationCollectionMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/explanations$/);
    if (v2ExplanationCollectionMatch && (req.method === "GET" || req.method === "POST")) {
      const auth = authOf(req);
      assertScope(auth, req.method === "GET" ? "evidence:read" : "decision:recommend");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2ExplanationCollectionMatch[1] ?? "");
      const exceptionId = decodeURIComponent(v2ExplanationCollectionMatch[2] ?? "");
      const store = getV2Store();
      const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
      if (!exception) return json(res, 404, { error: "not_found" });
      if (req.method === "GET") {
        return json(res, 200, {
          contextId,
          exceptionId,
          explanations: listGroundedExplanations(store, tenantId, contextId, exceptionId),
        });
      }
      const actor = requireActor(req);
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined) return json(res, 400, { error: "tenant_from_auth_required" });
      const explanation = await generateGroundedExplanation(
        store,
        resolveGroundedAiProvider(),
        tenantId,
        contextId,
        exceptionId,
        actor,
      );
      if (explanation.status === "rejected") {
        return json(res, 422, {
          error: groundingValidationErrorCode(explanation.validation) ?? "AI_GROUNDING_VALIDATION_FAILED",
          explanation,
        });
      }
      recordSecurityAudit(store, {
        auth,
        action: "explanation.generate",
        resourceType: "grounded_explanation",
        resourceId: explanation.id ?? exceptionId,
        result: "success",
        metadata: { contextId, exceptionId },
      });
      return json(res, 200, { explanation, stale: explanation.stale });
    }
    const v2ExceptionBundleMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/bundle$/);
    if (req.method === "GET" && v2ExceptionBundleMatch) {
      const auth = authOf(req);
      assertScope(auth, "evidence:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2ExceptionBundleMatch[1] ?? "");
      const exceptionId = decodeURIComponent(v2ExceptionBundleMatch[2] ?? "");
      const store = getV2Store();
      if (!store.getContext(tenantId, contextId)) return json(res, 404, { error: "not_found" });
      const bundle = store.getExceptionEvidenceBundle(tenantId, exceptionId);
      if (!bundle || bundle.contextId !== contextId) return json(res, 404, { error: "not_found" });
      return json(res, 200, bundle);
    }
    const v2ResolutionCapabilitiesMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/resolution-capabilities$/);
    if (req.method === "GET" && v2ResolutionCapabilitiesMatch) {
      const auth = authOf(req);
      assertScope(auth, "governance:read");
      const contextId = decodeURIComponent(v2ResolutionCapabilitiesMatch[1] ?? "");
      const exceptionId = decodeURIComponent(v2ResolutionCapabilitiesMatch[2] ?? "");
      const store = getV2Store();
      if (!store.getContext(auth.tenantId, contextId)) return json(res, 404, { error: "not_found" });
      const exception = store.listExceptions(auth.tenantId, contextId).find((item) => item.id === exceptionId);
      if (!exception) return json(res, 404, { error: "not_found" });
      const resolutionCase = store.getResolutionCaseByException(auth.tenantId, exceptionId);
      const bundle = store.getExceptionEvidenceBundle(auth.tenantId, exceptionId);
      return json(res, 200, buildResolutionCapabilities({
        currentActor: currentActorProjection(auth),
        exception,
        hasEvidenceBundle: Boolean(bundle),
        ...(resolutionCase ? { resolutionCase } : {}),
      }));
    }
    const v2ResolutionCreateMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions\/([^/]+)\/resolution-case$/);
    if (req.method === "POST" && v2ResolutionCreateMatch) {
      const auth = mutationAuth(req, "governance:submit");
      const actor = { subjectId: auth.subjectId, displayName: auth.displayName, roles: auth.roles };
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2ResolutionCreateMatch[1] ?? "");
      const exceptionId = decodeURIComponent(v2ResolutionCreateMatch[2] ?? "");
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined) return json(res, 400, { error: "tenant_from_auth_required" });
      const ownerRole = typeof input.ownerRole === "string" ? input.ownerRole.trim() : "";
      const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
      if (!ownerRole) return json(res, 422, { error: "resolution_owner_role_required" });
      if (!isAssignableOwnerRole(ownerRole)) return json(res, 422, { error: "resolution_owner_role_not_assignable" });
      if (!rationale) return json(res, 422, { error: "resolution_acceptance_rationale_required" });
      const store = getV2Store();
      // 租户边界先于能力判定：跨租户资源与不存在的资源一律 404，不通过 403/409 泄漏存在性。
      if (!store.getContext(tenantId, contextId)) return json(res, 404, { error: "not_found" });
      const exception = store.listExceptions(tenantId, contextId).find((item) => item.id === exceptionId);
      if (!exception) return json(res, 404, { error: "not_found" });
      const bundle = store.getExceptionEvidenceBundle(tenantId, exceptionId);
      const decision = canAcceptResolution(actor, {
        hasResolutionCase: Boolean(store.getResolutionCaseByException(tenantId, exceptionId)),
        exceptionStatus: exception.status,
        hasEvidenceBundle: Boolean(bundle),
      });
      assertResolutionPermission(decision);
      const resolution = acceptExceptionForResolution(store, tenantId, contextId, exceptionId, {
        ownerRole,
        rationale,
        actor,
      });
      recordSecurityAudit(store, {
        auth,
        action: "resolution.accept",
        resourceType: "resolution_case",
        resourceId: resolution.id ?? exceptionId,
        result: "success",
        metadata: { contextId, exceptionId, decision: ownerRole },
      });
      return json(res, 200, resolution);
    }
    const v2ContextResolutionListMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/resolution-cases$/);
    if (req.method === "GET" && v2ContextResolutionListMatch) {
      const auth = authOf(req);
      assertScope(auth, "governance:read");
      const tenantId = auth.tenantId;
      const contextId = decodeURIComponent(v2ContextResolutionListMatch[1] ?? "");
      const store = getV2Store();
      if (!store.getContext(tenantId, contextId)) return json(res, 404, { error: "not_found" });
      return json(res, 200, {
        contextId,
        resolutionCases: store.listResolutionCases(tenantId, contextId).map((item) => ({
          id: item.id,
          exceptionId: item.exceptionId,
          status: item.status,
          ownerRole: item.ownerRole,
          title: item.runtime.title,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      });
    }
    const v2ResolutionQueryMatch = url.pathname.match(/^\/api\/v2\/resolution-cases\/([^/]+)$/);
    if (req.method === "GET" && v2ResolutionQueryMatch) {
      const auth = authOf(req);
      assertScope(auth, "governance:read");
      const tenantId = auth.tenantId;
      const caseId = decodeURIComponent(v2ResolutionQueryMatch[1] ?? "");
      const result = queryResolutionCase(getV2Store(), tenantId, caseId);
      if (!result) return json(res, 404, { error: "not_found" });
      return json(res, 200, result);
    }
    const v2ResolutionActionMatch = url.pathname.match(/^\/api\/v2\/resolution-cases\/([^/]+)\/(review|propose|submit|approve|execute|close)$/);
    if (req.method === "POST" && v2ResolutionActionMatch) {
      const caseId = decodeURIComponent(v2ResolutionActionMatch[1] ?? "");
      const action = v2ResolutionActionMatch[2];
      // scope 与领域 workflow/SoD 是两道独立闸门：这里先按动作要求 scope，
      // 再由 canXxxResolution 判断角色、流程状态与职责分离。
      const ACTION_SCOPES: Record<string, "governance:submit" | "governance:approve" | "execution:run"> = {
        review: "governance:submit",
        propose: "governance:submit",
        submit: "governance:submit",
        approve: "governance:approve",
        execute: "execution:run",
        close: "governance:approve",
      };
      const auth = mutationAuth(req, ACTION_SCOPES[action ?? ""] ?? "governance:submit");
      const actor = { subjectId: auth.subjectId, displayName: auth.displayName, roles: auth.roles };
      const tenantId = auth.tenantId;
      const input = await readJson(req);
      if (input.tenant !== undefined || input.tenantId !== undefined) return json(res, 400, { error: "tenant_from_auth_required" });
      const store = getV2Store();
      const current = store.getResolutionCase(tenantId, caseId);
      if (!current) return json(res, 404, { error: "not_found" });
      if (action === "review") {
        const decision = String(input.decision || "");
        const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
        if (!["confirm", "needs_evidence", "reject"].includes(decision)) return json(res, 422, { error: "invalid_resolution_review_decision" });
        if (!rationale) return json(res, 422, { error: "resolution_review_rationale_required" });
        assertResolutionPermission(canReviewResolution(actor, current));
        const resolution = reviewResolution(store, tenantId, caseId, { decision: decision as "confirm" | "needs_evidence" | "reject", rationale, actor });
        recordSecurityAudit(store, {
          auth,
          action: "resolution.review",
          resourceType: "resolution_case",
          resourceId: caseId,
          result: "success",
          metadata: { decision, status: resolution?.status ?? "unknown" },
        });
        return json(res, 200, resolution);
      }
      if (action === "propose") {
        if (!Array.isArray(input.actions) || !input.actions.length) return json(res, 422, { error: "resolution_actions_required" });
        const actions: ResolutionActionInput[] = input.actions
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({ type: String(item.type || "") as ResolutionActionInput["type"], summary: String(item.summary || "") }));
        assertResolutionPermission(canProposeResolution(actor, current));
        const resolution = proposeResolutionCase(store, tenantId, caseId, { actions, actor });
        recordSecurityAudit(store, {
          auth,
          action: "resolution.propose",
          resourceType: "resolution_case",
          resourceId: caseId,
          result: "success",
          metadata: { status: resolution?.status ?? "unknown", actionCount: actions.length },
        });
        return json(res, 200, resolution);
      }
      if (action === "submit") {
        assertResolutionPermission(canSubmitResolution(actor, current));
        const resolution = submitResolutionCase(store, tenantId, caseId, actor);
        recordSecurityAudit(store, {
          auth,
          action: "resolution.submit",
          resourceType: "resolution_case",
          resourceId: caseId,
          result: "success",
          metadata: { status: resolution?.status ?? "unknown" },
        });
        return json(res, 200, resolution);
      }
      if (action === "approve") {
        if (input.actor !== undefined || input.roles !== undefined) return json(res, 400, { error: "actor_and_roles_from_auth_required" });
        assertResolutionPermission(canApproveResolution(actor, current));
        // 回源闸门：证据无法回源时，异常保留但不允许进入审批（fail-closed）。
        const gate = evaluateTraceabilityGate({
          store,
          tenantId,
          contextId: current.contextId,
          exceptionId: current.exceptionId,
          payloadSourcePath: resolveTraceabilityStreamPath(),
          stage: "approval",
        });
        if (!gate.decision.allowed) {
          recordSecurityAudit(store, {
            auth,
            action: "resolution.approve",
            resourceType: "resolution_case",
            resourceId: caseId,
            result: "denied",
            metadata: { reasonCode: gate.decision.reasonCode, traceStatus: gate.trace.status },
          });
          return json(res, 409, {
            error: gate.decision.reasonCode,
            status: gate.decision.status,
            reason: gate.decision.reason,
            traceStatus: gate.trace.status,
            failures: gate.decision.failures,
          });
        }
        const resolution = approveResolutionCase(store, tenantId, caseId, actor);
        recordSecurityAudit(store, {
          auth,
          action: "resolution.approve",
          resourceType: "resolution_case",
          resourceId: caseId,
          result: "success",
          metadata: { status: resolution?.status ?? "unknown" },
        });
        return json(res, 200, resolution);
      }
      if (action === "execute") {
        if (input.actor !== undefined || input.roles !== undefined) return json(res, 400, { error: "actor_and_roles_from_auth_required" });
        assertResolutionPermission(canExecuteResolution(actor, current));
        const executeGate = evaluateTraceabilityGate({
          store,
          tenantId,
          contextId: current.contextId,
          exceptionId: current.exceptionId,
          payloadSourcePath: resolveTraceabilityStreamPath(),
          stage: "execution",
        });
        if (!executeGate.decision.allowed) {
          recordSecurityAudit(store, {
            auth,
            action: "resolution.execute",
            resourceType: "resolution_case",
            resourceId: caseId,
            result: "denied",
            metadata: { reasonCode: executeGate.decision.reasonCode, traceStatus: executeGate.trace.status },
          });
          return json(res, 409, {
            error: executeGate.decision.reasonCode,
            status: executeGate.decision.status,
            reason: executeGate.decision.reason,
            traceStatus: executeGate.trace.status,
            failures: executeGate.decision.failures,
          });
        }
        const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim() : undefined;
        const resolution = executeResolutionCase(store, tenantId, caseId, actor, idempotencyKey);
        recordSecurityAudit(store, {
          auth,
          action: "resolution.execute",
          resourceType: "resolution_case",
          resourceId: caseId,
          result: "success",
          metadata: { status: resolution?.status ?? "unknown" },
        });
        return json(res, 200, resolution);
      }
      assertResolutionPermission(canCloseResolution(actor, current));
      const resolution = closeResolutionCase(store, tenantId, caseId, actor);
      recordSecurityAudit(store, {
        auth,
        action: "resolution.close",
        resourceType: "resolution_case",
        resourceId: caseId,
        result: "success",
        metadata: { status: resolution?.status ?? "unknown" },
      });
      return json(res, 200, resolution);
    }
    const capabilityMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/capabilities\/([^/]+)$/);
    if (capabilityMatch) {
      const id = decodeURIComponent(capabilityMatch[1] ?? "");
      const module = decodeURIComponent(capabilityMatch[2] ?? "");
      const tenantId = tenantOf(req);
      if (!["workbench", "monitor", "ontology", "adjudication", "sandbox", "actions", "more"].includes(module)) return json(res, 404, { error: "unknown_capability" });
      const g = gold(id);
      authorizeCase(req, g);
      if (req.method === "GET") return json(res, 200, capabilitySnapshot(module, tenantId, g, readCase(tenantId, id)));
      if (req.method === "POST" && module === "adjudication") {
        const input = await readJson(req);
        const decision = String(input.decision || "");
        const reason = ({ accept: "裁决认可", supplement: "裁决要求补材料", reject: "裁决退回重新核对" } as Record<string, string>)[decision];
        if (!reason) return json(res, 400, { error: "invalid_decision" });
        const actor = requireActor(req);
        assertRole(authOf(req), [...RESOLUTION_OWNER_ROLES]);
        const rationale = String(input.rationale || reason).trim();
        if (!rationale) return json(res, 400, { error: "decision_rationale_required" });
        const updated = await mutateCase(tenantId, id, (latest) => saveCase(tenantId, { ...latest, paused: decision !== "accept", reportDecision: { decision: decision as "accept" | "supplement" | "reject", rationale, actor, at: new Date().toISOString() }, events: [...latest.events, { at: new Date().toISOString(), from: latest.status, to: latest.status, actor, reason }] }));
        return json(res, 200, { ok: true, decision, runtime: updated });
      }
      if (req.method === "POST" && module === "sandbox") {
        const input = await readJson(req);
        const scenario = String(input.scenario || "");
        if (!["evidence", "claim", "hold"].includes(scenario)) return json(res, 400, { error: "invalid_scenario" });
        return json(res, 200, { ok: true, scenario, result: capabilitySnapshot(module, tenantId, g, readCase(tenantId, id)) });
      }
      if (req.method === "POST" && module === "more") {
        const input = await readJson(req);
        const action = String(input.action || "");
        if (!["versions", "review", "outcome", "audit"].includes(action)) return json(res, 400, { error: "invalid_capability_action" });
        const actor = requireActor(req);
        const result = typeof input.result === "string" ? input.result.trim() : "";
        const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
        if (action === "outcome" && (!result || !rationale)) return json(res, 422, { error: "outcome_result_and_rationale_required" });
        const record = { action: action as "versions" | "review" | "outcome" | "audit", status: "recorded" as const, ...(result ? { result } : {}), ...(rationale ? { rationale } : {}), actor, at: new Date().toISOString() };
        const updated = await mutateCase(tenantId, id, (latest) => saveCase(tenantId, { ...latest, capabilityRecords: [...(latest.capabilityRecords ?? []), record], events: [...latest.events, { at: record.at, from: latest.status, to: latest.status, actor, reason: `能力操作:${action}` }] }));
        return json(res, 200, { ok: true, action, record, runtime: updated });
      }
    }
    const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)(?:\/([^/]+))?$/);
    if (caseMatch) {
      const id = decodeURIComponent(caseMatch[1] ?? "");
      const action = caseMatch[2];
      const tenantId = tenantOf(req);
      const g = gold(id);
      authorizeCase(req, g);
      if (req.method === "GET" && !action) return json(res, 200, { gold: publicGold(g, tenantId), runtime: readCase(tenantId, id) });
      if (req.method === "GET" && action === "receipts") {
        return json(res, 200, { caseId: id, receipts: listCapabilityReceipts(tenantId, id) });
      }
      if (req.method === "GET" && action === "report") return json(res, 200, buildReport(g, readCase(tenantId, id)));
      if (req.method === "POST" && action === "refresh") {
        const actor = requireActor(req);
        const input = await readJson(req);
        if (!Array.isArray(input.endpoints) || !input.endpoints.length || input.endpoints.some((item) => !item || typeof item !== "object" || typeof (item as Record<string, unknown>).id !== "string" || typeof (item as Record<string, unknown>).url !== "string")) return json(res, 422, { error: "invalid_evidence_endpoints" });
        const endpoints = input.endpoints.map((item) => ({ id: String((item as Record<string, unknown>).id), url: String((item as Record<string, unknown>).url) }));
        endpoints.forEach((endpoint) => assertEndpointAllowed(endpoint.url));
        const format = input.format === "markdown" ? "markdown" : "csv";
        const kind = ["quote", "order", "payment", "complaint", "email", "alert"].includes(String(input.kind)) ? String(input.kind) as GoldCase["materials"][number]["kind"] : "order";
        const sourceId = typeof input.sourceId === "string" && input.sourceId.trim() ? input.sourceId.trim() : `${id}-${kind}-refresh`;
        try {
          const resolved = await resolveEvidenceSource(endpoints, { timeoutMs: 5000, validationErrorCode: format === "csv" ? "invalid_csv" : "invalid_payload", validate: format === "csv" ? (body) => { const parsed = parseCsv(body); if (!parsed.headers.length || !parsed.rows.length) throw new Error("empty_csv"); } : (body) => { if (!body.trim()) throw new Error("empty_markdown"); } });
          const updated = await mutateCase(tenantId, id, (latest) => {
            const scopedGold: GoldCase = g;
            const material = { sourceId, fileName: `${sourceId}.${format === "csv" ? "csv" : "md"}`, kind, version: typeof input.version === "string" && input.version.trim() ? input.version.trim() : "refresh-1", tenantId, scope: g.scope, ...(format === "csv" ? { csv: resolved.body } : { markdown: resolved.body }) };
            const refreshed = ingest({ ...scopedGold, materials: [...scopedGold.materials.filter((item) => item.sourceId !== sourceId), material] }, openCase({ ...scopedGold, materials: [...scopedGold.materials.filter((item) => item.sourceId !== sourceId), material] }));
            return saveCase(tenantId, { ...latest, status: "new", pack: { ...refreshed.pack!, sourceAttempts: resolved.attempts, selectedSourceId: resolved.selectedEndpointId }, findings: refreshed.findings, actions: [], reviewedConflictIds: undefined, reviewedIssueIds: undefined, conflictReviews: undefined, capabilityRecords: latest.capabilityRecords, events: [...latest.events, { at: new Date().toISOString(), from: latest.status, to: "new", actor, reason: `刷新材料:${resolved.selectedEndpointId}` }] });
          });
          return json(res, 200, { ok: true, selectedSourceId: resolved.selectedEndpointId, attempts: resolved.attempts, runtime: updated });
        } catch (error) {
          if (error instanceof EvidenceSourceError) return json(res, error.code === "evidence_source_rejected" ? 422 : 502, { error: error.code, attempts: error.attempts });
          if (error instanceof Error && (error.message === "INVALID_CSV" || error.message.startsWith("INVALID_CSV:"))) return json(res, 422, { error: "invalid_csv" });
          throw error;
        }
      }
      if (req.method === "POST" && action === "review") {
        const actor = requireActor(req);
        const input = await readJson(req);
        const rawReviews = input.reviews;
        let entries: Array<string | ConflictReviewInput> = [];
        if (rawReviews !== undefined) {
          if (!Array.isArray(rawReviews)) return json(res, 400, { error: "invalid_conflict_reviews" });
          entries = rawReviews
            .map((review) => review && typeof review === "object" ? review as Record<string, unknown> : null)
            .filter((review): review is Record<string, unknown> => Boolean(review))
            .map((review) => ({ conflictId: String(review.conflictId || ""), decision: String(review.decision || "") as ConflictReviewInput["decision"], selectedEvidenceId: typeof review.selectedEvidenceId === "string" ? review.selectedEvidenceId : undefined, selectedValue: review.selectedValue as ConflictReviewInput["selectedValue"], rationale: String(review.rationale || "") } as ConflictReviewInput));
        } else if (input.conflictIds !== undefined) {
          if (!Array.isArray(input.conflictIds) || input.conflictIds.some((id) => typeof id !== "string")) return json(res, 400, { error: "invalid_conflict_ids" });
          entries = input.conflictIds as string[];
        }
        if (!Array.isArray(entries) || entries.some((entry) => typeof entry === "string" ? !entry : !entry.conflictId || !entry.rationale || !["acknowledge", "accept_left", "accept_right", "needs_evidence"].includes(entry.decision))) return json(res, 400, { error: "invalid_conflict_reviews" });
        const updated = await mutateCase(tenantId, id, (latest) => saveCase(tenantId, reviewConflicts(latest, actor, entries)));
        return json(res, 200, updated);
      }
      if (req.method === "POST" && action === "propose") {
        const actor = requireActor(req);
        const updated = await mutateCase(tenantId, id, (latest) => {
          if (latest.pack?.gaps?.length) throw new HttpError(409, "gaps_required");
          if ((latest.pack?.conflictIssues?.length ?? latest.pack?.conflicts?.length ?? 0) > (latest.reviewedIssueIds?.length ?? 0)) throw new HttpError(409, "review_required");
          return saveCase(tenantId, submitForApproval(propose(latest, actor), actor));
        });
        return json(res, 200, updated);
      }
      if (req.method === "POST" && action === "approve") {
        const actor = requireActor(req);
        assertRole(authOf(req), [...RESOLUTION_APPROVER_ROLES]);
        return json(res, 200, await mutateCase(tenantId, id, (latest) => saveCase(tenantId, approve(latest, actor, undefined, authOf(req).roles))));
      }
      if (req.method === "POST" && action === "execute") {
        // The workbench's single "record result" click represents the whole approved plan.
        // Execute every authorized action so multi-action cases cannot be left half-complete.
        const actor = requireActor(req);
        assertRole(authOf(req), [...RESOLUTION_APPROVER_ROLES]);
        const input = req.method === "POST" ? await readJson(req) : {};
        const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined;
        return json(res, 200, await mutateCase(tenantId, id, (latest) => {
          const operationKey = idempotencyKey || latest.executionIdempotencyKey || `${tenantId}:${id}:execute`;
          const receiptFactory = (actionRecord: typeof latest.actions[number], operation: string) => {
            const payloadHash = createHash("sha256").update(JSON.stringify({ caseId: id, actionId: actionRecord.id, type: actionRecord.type, summary: actionRecord.summary, operationKey: operation })).digest("hex");
            const receipt = recordCapabilityReceipt({ tenantId, caseId: id, actionId: actionRecord.id, operationKey: operation, payloadHash });
            return { ...receipt, receiptAt: receipt.createdAt };
          };
          return saveCase(tenantId, execute(latest, actor, operationKey, receiptFactory));
        }));
      }
      if (req.method === "POST" && action === "close") {
        const actor = requireActor(req);
        assertRole(authOf(req), [...RESOLUTION_APPROVER_ROLES]);
        return json(res, 200, await mutateCase(tenantId, id, (latest) => saveCase(tenantId, verifyAndClose(latest, actor))));
      }
    }
    if (req.method === "GET" && url.pathname === "/api/eval") return json(res, 200, { ...evaluateAll(), contestCases: contestSet.length, fxCases: buildGoldSet().length });
    json(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) return json(res, error.status, { error: error.code });
    if (error instanceof GroundedAiError) return json(res, error.status, { error: error.code });
    if (error instanceof DecisionAiError) {
      const code = error.code.startsWith("DECISION_PROVIDER_INVALID_OUTPUT")
        ? "DECISION_PROVIDER_INVALID_OUTPUT"
        : error.code;
      return json(res, error.status, { error: code });
    }
    if (error instanceof RootCauseAiError) {
      const code = error.code.startsWith("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT")
        ? "ROOT_CAUSE_PROVIDER_INVALID_OUTPUT"
        : error.code;
      return json(res, error.status, { error: code });
    }
    if (error instanceof PolicyError) return json(res, error.status, { error: error.code });
    if (error instanceof AutomationError) return json(res, error.status, { error: error.code });
    if (error instanceof OutcomeError) return json(res, error.status, { error: error.code });
    if (error instanceof SolutionPackError) return json(res, error.status, { error: error.code });
    if (error instanceof ConnectorError) return json(res, error.status, { error: error.code });
    if (error instanceof PowerBiError) return jsonNoStore(res, error.status, { error: error.code });
    if (error instanceof SupersetError) return jsonNoStore(res, error.status, { error: error.code });
    if (error instanceof OperationalAnalyticsError) return json(res, 400, { error: error.code });
    if (error instanceof AuthError) return json(res, error.status, { error: error.code });
    if (error instanceof Error && /^MIGRATION_|^STARTUP_/.test(error.message)) {
      opsLogger.error("ops.error", { errorCode: error.message });
      return json(res, 503, { error: error.message });
    }
    if (error instanceof EvidenceError) {
      const status = error.code === "CROSS_TENANT_SOURCE" ? 403 : error.code === "NO_SCOPE" ? 409 : error.code === "NO_TENANT" || error.code === "INVALID_CSV" ? 422 : 409;
      return json(res, status, { error: error.code });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === "ACTION_NOT_APPLICABLE") return json(res, 409, { error: message });
    if (message === "ROLE_NOT_ALLOWED" || message === "read_only_principal") return json(res, 403, { error: message });
    if (message === "APPROVAL_SUBJECT_IDENTITY_REQUIRED") return json(res, 409, { error: message });
    if (message === "RESOLUTION_SUBJECT_ID_REQUIRED") return json(res, 422, { error: message });
    if (message === "resolution_owner_role_not_assignable") return json(res, 422, { error: message });
    const conflictCodes = new Set([
      "proposal_not_allowed",
      "approval_not_pending",
      "actions_not_ready",
      "forbidden_approver",
      "resolution_approval_not_allowed",
      "resolution_approval_not_submitted",
      "resolution_review_not_allowed",
      "resolution_proposal_not_allowed",
      "resolution_submit_not_allowed",
      "resolution_execution_not_allowed",
      "resolution_close_not_allowed",
      "resolution_exception_not_detected",
      "resolution_exception_bundle_required",
      "receipt_required",
      "SEGREGATION_OF_DUTIES_VIOLATION",
      "RESOLUTION_EXECUTION_IDEMPOTENCY_CONFLICT",
    ]);
    const domainCode = message.split(":")[0] ?? message;
    const isConflict = conflictCodes.has(message) || conflictCodes.has(domainCode);
    const status = message === "not_found" ? 404 : message.startsWith("invalid_risk_case_transition") || message.endsWith("_required") || isConflict ? 409 : 400;
    json(res, status, { error: isConflict ? domainCode : message });
  }
};

/**
 * 请求入口：requestId + 结构化访问日志 + inflight 计数（graceful shutdown 用）。
 * requestId 只用于把日志与审计串起来，不是安全 token。
 */
const server = createServer((req, res) => {
  const incoming = String(req.headers[REQUEST_ID_HEADER] ?? "").trim();
  const requestId = incoming && isSafeRequestId(incoming) ? incoming : randomUUID();
  const startedAt = process.hrtime.bigint();
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  res.setHeader("X-Request-ID", requestId);
  inFlightRequests += 1;
  res.once("finish", () => {
    inFlightRequests -= 1;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const context = currentRequestContext();
    opsLogger.info("http.request", {
      method: req.method ?? "GET",
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ...(context?.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context?.subjectId ? { subjectId: context.subjectId } : {}),
    });
  });
  void runWithRequestContext({ requestId, method: req.method ?? "GET", path }, async () => {
    if (shuttingDown) {
      json(res, 503, { error: "shutting_down" });
      return;
    }
    try {
      await handleRequest(req, res);
    } catch (error) {
      // handleRequest 自己已处理业务错误；这里只兜底进程级异常
      opsLogger.error("http.unhandled", { errorCode: error instanceof Error ? error.name : "unknown" });
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
    }
  });
});

const port = Number(process.env.PORT ?? 3410);
const host = process.env.HOST ?? "127.0.0.1";
validateAuthEnv();

// startup fail-closed：核心条件不满足就 exit non-zero，不进入“先起来再随机报错”的状态
const startup = assertStartupSafety(process.env);
for (const check of startup.checks) {
  opsLogger[check.status === "pass" ? "info" : "error"]("ops.startup_check", { check: check.id, status: check.status, detail: check.detail });
}
if (!startup.ok) {
  opsLogger.error("ops.startup_failed", { failures: startup.failures });
  console.error(JSON.stringify({ error: "STARTUP_CHECKS_FAILED", failures: startup.failures }));
  process.exit(1);
}

getV2Store();
server.listen(port, host, () => {
  opsLogger.info("ops.started", { host, port, version: process.env.npm_package_version ?? "0.1.0" });
  console.log(`履约例外工作台 http://${host}:${port}`);
});

/**
 * Graceful shutdown：停止接收新请求 → 等待在途请求 → 关闭 HTTP server → 关闭 SQLite → 退出。
 * 超时（默认 10s）后强制退出，避免容器 stop 时长时间悬挂。
 */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? "10000");
let shutdownTimer: NodeJS.Timeout | undefined;

function closeDatabase() {
  try {
    v2StoreDatabase?.close();
  } catch (error) {
    opsLogger.warn("ops.shutdown.db_close_failed", { errorCode: error instanceof Error ? error.name : "unknown" });
  }
}

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  opsLogger.info("ops.shutdown.begin", { signal, inFlightRequests });
  server.close(() => {
    // 不再接受新连接，且已有请求处理完毕
    closeDatabase();
    if (shutdownTimer) clearTimeout(shutdownTimer);
    opsLogger.info("ops.shutdown.complete", { signal });
    process.exit(exitCode);
  });
  const waitForInflight = () => {
    if (inFlightRequests <= 0) return;
    setTimeout(waitForInflight, 100);
  };
  waitForInflight();
  shutdownTimer = setTimeout(() => {
    opsLogger.error("ops.shutdown.timeout", { signal, inFlightRequests, timeoutMs: SHUTDOWN_TIMEOUT_MS });
    closeDatabase();
    process.exit(exitCode === 0 ? 124 : exitCode);
  }, SHUTDOWN_TIMEOUT_MS);
  shutdownTimer.unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGINT", () => shutdown("SIGINT", 0));
