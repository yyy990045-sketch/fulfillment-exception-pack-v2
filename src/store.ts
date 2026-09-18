import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CapabilityReceipt, CaseRecord } from "./types.js";

type DatabaseSyncLike = { exec(sql: string): void; prepare(sql: string): { all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown }; };

function rootDir() {
  return process.env.PACK_STORE_DIR || join(process.cwd(), "data", "pack-cases");
}

function tenantFile(tenantId: string) {
  const key = createHash("sha256").update(tenantId).digest("hex").slice(0, 32);
  return join(rootDir(), `${key}.json`);
}

function legacyTenantFile(tenantId: string) {
  return join(rootDir(), `${tenantId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function sqlitePath() {
  return process.env.PACK_STORE_DB || join(rootDir(), "pack-cases.sqlite");
}

const sqliteDatabases = new Map<string, DatabaseSyncLike>();
function sqliteDb() {
  const file = sqlitePath();
  const existing = sqliteDatabases.get(file);
  if (existing) return existing;
  mkdirSync(rootDir(), { recursive: true });
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseSyncLike } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
  const db = new builtin.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS cases (tenant_id TEXT NOT NULL, case_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant_id, case_id)); CREATE TABLE IF NOT EXISTS capability_receipts (tenant_id TEXT NOT NULL, case_id TEXT NOT NULL, action_id TEXT NOT NULL, operation_key TEXT NOT NULL, external_request_id TEXT NOT NULL, receipt TEXT NOT NULL, receipt_source TEXT NOT NULL, status TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, operation_key, action_id)); CREATE INDEX IF NOT EXISTS capability_receipts_case_idx ON capability_receipts (tenant_id, case_id, created_at);");
  sqliteDatabases.set(file, db);
  return db;
}

function sqliteEnabled() { return process.env.PACK_STORE_BACKEND === "sqlite"; }

function acquireTenantLock(file: string) {
  const lock = `${file}.lock`;
  mkdirSync(rootDir(), { recursive: true });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const fd = openSync(lock, "wx");
      return { fd, lock };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock);
      } catch {
        // Another process may have released the lock between stat/unlink.
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new Error("tenant_store_busy");
}

export function loadCases(tenantId: string): Record<string, CaseRecord> {
  if (!tenantId) throw new Error("NO_TENANT");
  if (sqliteEnabled()) {
    const rows = sqliteDb().prepare("SELECT case_id, payload FROM cases WHERE tenant_id = ?").all(tenantId) as Array<{ case_id: string; payload: string }>;
    return Object.fromEntries(rows.map((row) => [row.case_id, JSON.parse(row.payload) as CaseRecord]));
  }
  const file = tenantFile(tenantId);
  const readableFile = existsSync(file) ? file : legacyTenantFile(tenantId);
  if (!existsSync(readableFile)) return {};
  return JSON.parse(readFileSync(readableFile, "utf8")) as Record<string, CaseRecord>;
}

export function saveCase(tenantId: string, runtime: CaseRecord) {
  if (runtime.tenantId && runtime.tenantId !== tenantId) throw new Error("cross_tenant");
  if (sqliteEnabled()) {
    const db = sqliteDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO cases (tenant_id, case_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, case_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").run(tenantId, runtime.id, JSON.stringify({ ...runtime, tenantId }), new Date().toISOString());
      db.exec("COMMIT");
      return { ...runtime, tenantId };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    }
  }
  const file = tenantFile(tenantId);
  const guard = acquireTenantLock(file);
  try {
    const all = loadCases(tenantId);
    all[runtime.id] = { ...runtime, tenantId };
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, file);
    return all[runtime.id]!;
  } finally {
    closeSync(guard.fd);
    try { unlinkSync(guard.lock); } catch { /* already released after a stale-lock recovery */ }
  }
}

export function getCase(tenantId: string, id: string) {
  return loadCases(tenantId)[id];
}

function receiptFile() {
  return join(rootDir(), "capability-receipts.json");
}

function receiptId(input: Pick<CapabilityReceipt, "tenantId" | "caseId" | "actionId" | "operationKey" | "payloadHash">) {
  return `cap-${createHash("sha256").update(`${input.tenantId}:${input.caseId}:${input.actionId}:${input.operationKey}:${input.payloadHash}`).digest("hex").slice(0, 24)}`;
}

export function recordCapabilityReceipt(input: { tenantId: string; caseId: string; actionId: string; operationKey: string; payloadHash: string }): CapabilityReceipt {
  const createdAt = new Date().toISOString();
  const externalRequestId = receiptId(input);
  const receipt = `local-ledger:${externalRequestId}`;
  if (sqliteEnabled()) {
    const db = sqliteDb();
    const existing = db.prepare("SELECT tenant_id as tenantId, case_id as caseId, action_id as actionId, operation_key as operationKey, external_request_id as externalRequestId, receipt, receipt_source as receiptSource, status, payload_hash as payloadHash, created_at as createdAt FROM capability_receipts WHERE tenant_id = ? AND operation_key = ? AND action_id = ?").all(input.tenantId, input.operationKey, input.actionId) as CapabilityReceipt[];
    if (existing[0]) return existing[0];
    db.exec("BEGIN IMMEDIATE");
    try {
      const raced = db.prepare("SELECT tenant_id as tenantId, case_id as caseId, action_id as actionId, operation_key as operationKey, external_request_id as externalRequestId, receipt, receipt_source as receiptSource, status, payload_hash as payloadHash, created_at as createdAt FROM capability_receipts WHERE tenant_id = ? AND operation_key = ? AND action_id = ?").all(input.tenantId, input.operationKey, input.actionId) as CapabilityReceipt[];
      if (raced[0]) { db.exec("COMMIT"); return raced[0]; }
      db.prepare("INSERT INTO capability_receipts (tenant_id, case_id, action_id, operation_key, external_request_id, receipt, receipt_source, status, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.tenantId, input.caseId, input.actionId, input.operationKey, externalRequestId, receipt, "local-ledger", "succeeded", input.payloadHash, createdAt);
      db.exec("COMMIT");
      return { ...input, externalRequestId, receipt, receiptSource: "local-ledger", status: "succeeded", createdAt };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    }
  }
  const file = receiptFile();
  const guard = acquireTenantLock(file);
  try {
    mkdirSync(rootDir(), { recursive: true });
    const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Record<string, CapabilityReceipt> : {};
    const key = `${input.tenantId}:${input.operationKey}:${input.actionId}`;
    if (all[key]) return all[key]!;
    const result: CapabilityReceipt = { ...input, externalRequestId, receipt, receiptSource: "local-ledger", status: "succeeded", createdAt };
    all[key] = result;
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, file);
    return result;
  } finally {
    closeSync(guard.fd);
    try { unlinkSync(guard.lock); } catch { /* already released */ }
  }
}

export function listCapabilityReceipts(tenantId: string, caseId?: string): CapabilityReceipt[] {
  if (sqliteEnabled()) {
    const rows = (caseId
      ? sqliteDb().prepare("SELECT tenant_id as tenantId, case_id as caseId, action_id as actionId, operation_key as operationKey, external_request_id as externalRequestId, receipt, receipt_source as receiptSource, status, payload_hash as payloadHash, created_at as createdAt FROM capability_receipts WHERE tenant_id = ? AND case_id = ? ORDER BY created_at").all(tenantId, caseId)
      : sqliteDb().prepare("SELECT tenant_id as tenantId, case_id as caseId, action_id as actionId, operation_key as operationKey, external_request_id as externalRequestId, receipt, receipt_source as receiptSource, status, payload_hash as payloadHash, created_at as createdAt FROM capability_receipts WHERE tenant_id = ? ORDER BY created_at").all(tenantId)) as CapabilityReceipt[];
    return rows;
  }
  const file = receiptFile();
  if (!existsSync(file)) return [];
  const all = Object.values(JSON.parse(readFileSync(file, "utf8")) as Record<string, CapabilityReceipt>);
  return all.filter((item) => item.tenantId === tenantId && (!caseId || item.caseId === caseId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
