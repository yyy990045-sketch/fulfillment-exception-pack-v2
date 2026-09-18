import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContestSet, buildGoldSet } from "./gold-set/cases.js";
import { evaluateAll } from "./eval/run.js";
import { approve, execute, ingest, openCase, propose, reviewConflicts, submitForApproval, verifyAndClose } from "./case/runtime.js";
import type { ConflictReviewInput } from "./case/runtime.js";
import { getCase, listCapabilityReceipts, recordCapabilityReceipt, saveCase } from "./store.js";
import type { GoldCase } from "./types.js";
import { buildReport } from "./report/build.js";
import { assertRole, assertScope, assertTenant, authenticate, AuthError, isDemoMode, validateAuthEnv, type AuthContext } from "./auth.js";
import { EvidenceSourceError, resolveEvidenceSource } from "./evidence/endpoints.js";
import { EvidenceError, parseCsv } from "./evidence/extract.js";
import { evaluateFulfillmentExceptions, openV2SqliteStore, type V2SqliteStore } from "./domain/v2/index.js";

const contestSet = buildContestSet();
const ROOT = dirname(fileURLToPath(import.meta.url));
const caseMutationQueues = new Map<string, Promise<void>>();
let v2Store: V2SqliteStore | undefined;

function getV2Store() {
  v2Store ??= openV2SqliteStore();
  return v2Store;
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

function tenantOf(req: import("node:http").IncomingMessage) {
  return authenticate(req.headers).tenantId;
}

function actorOf(req: import("node:http").IncomingMessage) {
  return authenticate(req.headers).displayName;
}

function requireActor(req: import("node:http").IncomingMessage) {
  const raw = String(req.headers["x-actor"] || "").trim();
  if (isDemoMode() && !raw && !req.headers.authorization) throw new HttpError(401, "actor_required");
  return actorOf(req);
}

function authOf(req: import("node:http").IncomingMessage): AuthContext { return authenticate(req.headers); }

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      const html = readFileSync(join(ROOT, "workbench", "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true });
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
      const tenantId = authOf(req).tenantId;
      const contextId = decodeURIComponent(v2ReplayMatch[1] ?? "");
      const store = getV2Store();
      const replay = store.replayContext(tenantId, contextId);
      if (!replay.context) return json(res, 404, { error: "not_found" });
      return json(res, 200, replay);
    }
    const v2ExceptionsMatch = url.pathname.match(/^\/api\/v2\/contexts\/([^/]+)\/exceptions$/);
    if (req.method === "GET" && v2ExceptionsMatch) {
      const tenantId = authOf(req).tenantId;
      const contextId = decodeURIComponent(v2ExceptionsMatch[1] ?? "");
      const replay = getV2Store().replayContext(tenantId, contextId);
      if (!replay.context) return json(res, 404, { error: "not_found" });
      return json(res, 200, { contextId, exceptions: evaluateFulfillmentExceptions(replay) });
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
        assertRole(authOf(req), ["品质负责人", "销售总监", "工程师", "管理员", "总经理", "财务"]);
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
        assertRole(authOf(req), ["总经理", "管理员", "销售总监", "财务", "工程师"]);
        return json(res, 200, await mutateCase(tenantId, id, (latest) => saveCase(tenantId, approve(latest, actor, undefined, authOf(req).roles))));
      }
      if (req.method === "POST" && action === "execute") {
        // The workbench's single "record result" click represents the whole approved plan.
        // Execute every authorized action so multi-action cases cannot be left half-complete.
        const actor = requireActor(req);
        assertRole(authOf(req), ["总经理", "管理员", "销售总监", "财务", "工程师"]);
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
        assertRole(authOf(req), ["总经理", "管理员", "销售总监", "财务", "工程师"]);
        return json(res, 200, await mutateCase(tenantId, id, (latest) => saveCase(tenantId, verifyAndClose(latest, actor))));
      }
    }
    if (req.method === "GET" && url.pathname === "/api/eval") return json(res, 200, { ...evaluateAll(), contestCases: contestSet.length, fxCases: buildGoldSet().length });
    json(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) return json(res, error.status, { error: error.code });
    if (error instanceof AuthError) return json(res, error.status, { error: error.code });
    if (error instanceof EvidenceError) {
      const status = error.code === "CROSS_TENANT_SOURCE" ? 403 : error.code === "NO_SCOPE" ? 409 : error.code === "NO_TENANT" || error.code === "INVALID_CSV" ? 422 : 409;
      return json(res, status, { error: error.code });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "not_found" ? 404 : message.startsWith("invalid_risk_case_transition") || message.endsWith("_required") || message === "proposal_not_allowed" || message === "approval_not_pending" || message === "actions_not_ready" || message === "forbidden_approver" ? 409 : 400;
    json(res, status, { error: message });
  }
});

const port = Number(process.env.PORT ?? 3410);
const host = process.env.HOST ?? "127.0.0.1";
validateAuthEnv();
server.listen(port, host, () => {
  console.log(`履约例外工作台 http://${host}:${port}`);
});
