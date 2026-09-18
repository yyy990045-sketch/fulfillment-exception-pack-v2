import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { assertScope, authenticate, validateAuthEnv } from "../src/auth.js";
import { EvidenceSourceError, resolveEvidenceSource } from "../src/evidence/endpoints.js";
import { buildGoldSet } from "../src/gold-set/cases.js";
import { listCapabilityReceipts, loadCases, recordCapabilityReceipt, saveCase } from "../src/store.js";
import { openCase } from "../src/case/runtime.js";

function jwt(secret: string, claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode(claims);
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("production boundaries", () => {
  it("rejects forged demo headers in production and accepts a verified bearer token", () => {
    const previous = { node: process.env.NODE_ENV, demo: process.env.DEMO_MODE, secret: process.env.AUTH_SECRET };
    const secret = "01234567890123456789012345678901";
    try {
      process.env.NODE_ENV = "production";
      process.env.DEMO_MODE = "false";
      process.env.AUTH_SECRET = secret;
      expect(() => validateAuthEnv()).not.toThrow();
      expect(() => authenticate({ "x-actor": "admin", "x-tenant-id": "other" })).toThrow(/auth_required/);
      const token = jwt(secret, { sub: "user-1", tenant_id: "tenant-a", roles: ["销售总监"], scopes: ["fulfillment:sales"], exp: Math.floor(Date.now() / 1000) + 300 });
      const context = authenticate({ authorization: `Bearer ${token}` });
      expect(context).toMatchObject({ subjectId: "user-1", tenantId: "tenant-a", authnMethod: "jwt-hs256" });
      expect(() => assertScope(context, "fulfillment:sales")).not.toThrow();
      expect(() => assertScope(context, "it-alert:ops")).toThrow(/scope_forbidden/);
    } finally {
      if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node;
      if (previous.demo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previous.demo;
      if (previous.secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous.secret;
    }
  });

  it("uses ordered endpoint fallback and records failure classes", async () => {
    const calls: string[] = [];
    const result = await resolveEvidenceSource([
      { id: "primary", url: "http://127.0.0.1/primary" },
      { id: "fallback", url: "http://127.0.0.1/fallback" },
    ], {
      fetchImpl: async (url) => {
        const target = String(url);
        calls.push(target);
        return target.endsWith("primary") ? new Response("bad,csv\n\"", { status: 200 }) : new Response("订单号,数量\nSO-1,2\n", { status: 200 });
      },
      validate: (body) => { if (!body.includes("SO-1")) throw new Error("invalid"); },
    });
    expect(calls).toEqual(["http://127.0.0.1/primary", "http://127.0.0.1/fallback"]);
    expect(result.selectedEndpointId).toBe("fallback");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["fallback", "selected"]);
    await expect(resolveEvidenceSource([{ id: "forbidden", url: "http://127.0.0.1/forbidden" }], { fetchImpl: async () => new Response("no", { status: 401 }) })).rejects.toMatchObject({ code: "evidence_source_rejected" });
    await expect(resolveEvidenceSource([{ id: "down", url: "http://127.0.0.1/down" }], { fetchImpl: async () => { throw new Error("down"); } })).rejects.toBeInstanceOf(EvidenceSourceError);
  });

  it("persists tenant cases in a transactional SQLite backend", () => {
    const previous = { backend: process.env.PACK_STORE_BACKEND, db: process.env.PACK_STORE_DB };
    const dir = mkdtempSync("/tmp/fep-sqlite-");
    try {
      process.env.PACK_STORE_BACKEND = "sqlite";
      process.env.PACK_STORE_DB = join(dir, "cases.sqlite");
      const gold = buildGoldSet()[0]!;
      const first = openCase({ ...gold, tenantId: "tenant-a" });
      const second = { ...first, id: "FX-002" };
      saveCase("tenant-a", first);
      saveCase("tenant-a", second);
      expect(Object.keys(loadCases("tenant-a"))).toEqual(expect.arrayContaining(["FX-001", "FX-002"]));
      expect(Object.keys(loadCases("tenant-a"))).toHaveLength(2);
      const receipt = recordCapabilityReceipt({ tenantId: "tenant-a", caseId: "FX-002", actionId: "FX-002-act-1", operationKey: "test-execution-1", payloadHash: "a".repeat(64) });
      expect(recordCapabilityReceipt({ tenantId: "tenant-a", caseId: "FX-002", actionId: "FX-002-act-1", operationKey: "test-execution-1", payloadHash: "b".repeat(64) })).toMatchObject({ externalRequestId: receipt.externalRequestId, payloadHash: receipt.payloadHash });
      expect(listCapabilityReceipts("tenant-a", "FX-002")).toHaveLength(1);
    } finally {
      if (previous.backend === undefined) delete process.env.PACK_STORE_BACKEND; else process.env.PACK_STORE_BACKEND = previous.backend;
      if (previous.db === undefined) delete process.env.PACK_STORE_DB; else process.env.PACK_STORE_DB = previous.db;
    }
  });
});
