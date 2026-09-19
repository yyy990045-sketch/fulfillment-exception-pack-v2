import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReferenceInternalTaskHttpConnector,
  drainConnectorOutbox,
  enqueueInternalWorkItemDelivery,
  installConnector,
  registerBuiltInConnectors,
} from "../src/connectors/index.js";
import { InternalAutomationExecutor, executePolicyAutomation } from "../src/automation/index.js";
import { evaluateDecisionPolicy } from "../src/policy/index.js";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";
import { financeReconciliationPack, registerBuiltInSolutionPacks } from "../src/solution-packs/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];
const servers: Server[] = [];

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-connector-"));
  const db = new sqlite!.DatabaseSync(join(dir, "connector.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

async function startServer(handler: (request: any, response: any, body: Record<string, unknown>) => Promise<void> | void) {
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    await handler(request, response, body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server_address_missing");
  return `http://127.0.0.1:${address.port}`;
}

function json(response: any, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function createManufacturingWorkItem(store: V2SqliteStore, tenantId = "demo-manufacturing") {
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, tenantId, "ctx-so-mfg-001");
  const exception = store.listExceptions(tenantId, "ctx-so-mfg-001").find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
  const policy = evaluateDecisionPolicy(store, tenantId, "ctx-so-mfg-001", exception.id, { actionType: "create_task" }, "connector-owner");
  const run = executePolicyAutomation(store, tenantId, "ctx-so-mfg-001", exception.id, policy.id, "connector-owner", "human_request", {
    env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
    executor: new InternalAutomationExecutor(),
  });
  return { exception, run, workItem: run.workItem! };
}

async function installReference(store: V2SqliteStore, baseUrl: string, secretRef?: string) {
  registerBuiltInConnectors();
  return installConnector(store, new ReferenceInternalTaskHttpConnector(), {
    tenantId: "demo-manufacturing",
    installationId: "connector-installation-a",
    config: { baseUrl, timeoutMs: 500 },
    ...(secretRef ? { secretRef } : {}),
    actor: "connector-owner",
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const db of databases.splice(0)) db.close();
});

describe("Connector SDK and transactional outbox", () => {
  it("delivers an internal task over real HTTP and keeps WorkItem open", async () => {
    const requests: Array<{ key?: string; body: Record<string, unknown> }> = [];
    const baseUrl = await startServer(async (request, response, body) => {
      requests.push({ key: request.headers["idempotency-key"], body });
      json(response, 200, { externalRequestId: "external-request-1", externalResourceId: "external-task-001" });
    });
    const store = openStore();
    const { workItem, exception } = createManufacturingWorkItem(store);
    const before = {
      exception: store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.id === exception.id)!,
      resolutions: store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001").length,
      outcomes: store.listOutcomeEvaluations("demo-manufacturing", "ctx-so-mfg-001", exception.id).length,
    };
    const installation = await installReference(store, baseUrl);
    const outbox = enqueueInternalWorkItemDelivery(store, "demo-manufacturing", workItem.id, installation.id);
    const duplicate = enqueueInternalWorkItemDelivery(store, "demo-manufacturing", workItem.id, installation.id);
    expect(duplicate.id).toBe(outbox.id);
    const result = await drainConnectorOutbox(store, { workerId: "worker-a" });
    expect(result.receipt?.externalResourceId).toBe("external-task-001");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.key).toBe(outbox.operationKey);
    expect(store.getInternalWorkItem("demo-manufacturing", workItem.id)?.status).toBe("open");
    expect(store.listResolutionCases("demo-manufacturing", "ctx-so-mfg-001")).toHaveLength(before.resolutions);
    expect(store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.id === exception.id)?.latestRuleEvaluationId).toBe(before.exception.latestRuleEvaluationId);
    expect(store.listOutcomeEvaluations("demo-manufacturing", "ctx-so-mfg-001", exception.id)).toHaveLength(before.outcomes);
  });

  it("retries transient failures and dead-letters permanent failures", async () => {
    let transientCalls = 0;
    const transientUrl = await startServer(async (_request, response) => {
      transientCalls += 1;
      if (transientCalls === 1) json(response, 500, { error: "retry" });
      else json(response, 200, { externalRequestId: "retry-request", externalResourceId: "retry-task" });
    });
    const transientStore = openStore();
    const transientWork = createManufacturingWorkItem(transientStore);
    const transientInstall = await installReference(transientStore, transientUrl);
    const transientOutbox = enqueueInternalWorkItemDelivery(transientStore, "demo-manufacturing", transientWork.workItem.id, transientInstall.id);
    let now = Date.parse(transientOutbox.availableAt);
    const clock = () => new Date(now);
    await drainConnectorOutbox(transientStore, { workerId: "retry-worker", clock });
    now += 1_100;
    await drainConnectorOutbox(transientStore, { workerId: "retry-worker", clock });
    expect(transientCalls).toBe(2);
    const updatedTransientOutbox = transientStore.getConnectorOutbox("demo-manufacturing", transientOutbox.id)!;
    expect(updatedTransientOutbox.status).toBe("succeeded");
    expect(transientStore.listConnectorDeliveryAttempts("demo-manufacturing", transientOutbox.id)).toHaveLength(2);

    const permanentUrl = await startServer(async (_request, response) => json(response, 400, { error: "bad" }));
    const permanentStore = openStore();
    const permanentWork = createManufacturingWorkItem(permanentStore);
    const permanentInstall = await installReference(permanentStore, permanentUrl);
    const permanentOutbox = enqueueInternalWorkItemDelivery(permanentStore, "demo-manufacturing", permanentWork.workItem.id, permanentInstall.id);
    await drainConnectorOutbox(permanentStore, { workerId: "permanent-worker" });
    expect(permanentStore.getConnectorOutbox("demo-manufacturing", permanentOutbox.id)?.status).toBe("dead_letter");
    expect(permanentStore.getConnectorReceipt("demo-manufacturing", permanentOutbox.id)).toBeUndefined();
  });

  it("classifies timeout as retryable and never leaks secrets", async () => {
    const secret = "super-secret-value-123";
    process.env.TEST_CONNECTOR_SECRET = secret;
    const baseUrl = await startServer(async () => new Promise(() => {}));
    const store = openStore();
    const { workItem } = createManufacturingWorkItem(store);
    const installation = await installReference(store, baseUrl, "TEST_CONNECTOR_SECRET");
    const outbox = enqueueInternalWorkItemDelivery(store, "demo-manufacturing", workItem.id, installation.id);
    await drainConnectorOutbox(store, { workerId: "timeout-worker" });
    const attempts = store.listConnectorDeliveryAttempts("demo-manufacturing", outbox.id);
    expect(attempts[0]?.status).toBe("retryable_failure");
    expect(attempts[0]?.errorCode).toBe("CONNECTOR_TIMEOUT");
    expect(JSON.stringify(attempts)).not.toContain(secret);
    delete process.env.TEST_CONNECTOR_SECRET;
  }, 10_000);

  it("leases an outbox item to only one concurrent worker", async () => {
    let releases = 0;
    const baseUrl = await startServer(async (_request, response) => {
      releases += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      json(response, 200, { externalRequestId: "one-request", externalResourceId: "one-task" });
    });
    const store = openStore();
    const { workItem } = createManufacturingWorkItem(store);
    const installation = await installReference(store, baseUrl);
    enqueueInternalWorkItemDelivery(store, "demo-manufacturing", workItem.id, installation.id);
    const results = await Promise.all([
      drainConnectorOutbox(store, { workerId: "worker-1" }),
      drainConnectorOutbox(store, { workerId: "worker-2" }),
    ]);
    expect(results.filter((item) => item.claimed === 1)).toHaveLength(1);
    expect(releases).toBe(1);
  }, 10_000);

  it("reuses the Idempotency-Key after a local finalize crash window", async () => {
    const keys: string[] = [];
    const baseUrl = await startServer(async (request, response) => {
      keys.push(String(request.headers["idempotency-key"]));
      json(response, 200, { externalRequestId: "stable-request", externalResourceId: "external-task-001" });
    });
    const store = openStore();
    const { workItem } = createManufacturingWorkItem(store);
    const installation = await installReference(store, baseUrl);
    const outbox = enqueueInternalWorkItemDelivery(store, "demo-manufacturing", workItem.id, installation.id);
    let now = Date.parse(outbox.availableAt);
    const clock = () => new Date(now);
    await expect(drainConnectorOutbox(store, {
      workerId: "crash-worker",
      clock,
      onBeforeFinalize: () => { throw new Error("simulated crash"); },
    })).rejects.toThrow(/simulated crash/);
    now += 61_000;
    await drainConnectorOutbox(store, { workerId: "recovery-worker", clock });
    expect(new Set(keys).size).toBe(1);
    expect(store.getConnectorReceipt("demo-manufacturing", outbox.id)?.externalResourceId).toBe("external-task-001");
    expect(store.listConnectorDeliveryAttempts("demo-manufacturing", outbox.id)).toHaveLength(1);
  }, 10_000);

  it("reuses the same connector for Finance without Pack coupling", async () => {
    registerBuiltInSolutionPacks();
    const baseUrl = await startServer(async (_request, response) => json(response, 200, { externalRequestId: "finance-request", externalResourceId: "finance-task" }));
    const store = openStore();
    financeReconciliationPack.install(store, "demo-finance", "installer");
    financeReconciliationPack.provisionDemo?.(store, "demo-finance", "installer");
    evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001");
    const exception = store.listExceptions("demo-finance", "ctx-fin-rec-001").find((item) => item.code === "FINANCE.RECEIVABLE_PAYMENT_BALANCE_OUTSTANDING")!;
    const policy = evaluateDecisionPolicy(store, "demo-finance", "ctx-fin-rec-001", exception.id, { actionType: "create_task" }, "finance-owner");
    const run = executePolicyAutomation(store, "demo-finance", "ctx-fin-rec-001", exception.id, policy.id, "finance-owner", "human_request", {
      env: { AUTOMATION_ENABLED: "true", AUTOMATION_EXECUTOR: "internal" },
      executor: new InternalAutomationExecutor(),
    });
    registerBuiltInConnectors();
    const installation = installConnector(store, new ReferenceInternalTaskHttpConnector(), {
      tenantId: "demo-finance",
      installationId: "finance-connector",
      config: { baseUrl },
      actor: "finance-owner",
    });
    enqueueInternalWorkItemDelivery(store, "demo-finance", run.workItem!.id, installation.id);
    const delivered = await drainConnectorOutbox(store, { workerId: "finance-worker" });
    expect(delivered.receipt?.externalResourceId).toBe("finance-task");
  });
});
