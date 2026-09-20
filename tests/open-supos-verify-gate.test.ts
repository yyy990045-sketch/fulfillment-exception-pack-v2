import { describe, expect, it } from "vitest";
import {
  runOpenSupOSVerificationGate,
  type GateDependencies,
} from "../src/integrations/open-supos/verify-cli.js";
import type {
  OpenSupOSRuntimeVerificationReport,
  OpenSupOSRuntimeVerificationSummary,
  RuntimeVerificationResult,
} from "../src/integrations/open-supos/runtime-verify.js";

const ALL_CHECKS = [
  "runtime.health",
  "runtime.components",
  "mqtt.publish",
  "mqtt.subscribe",
  "connector.ingest",
  "domain.commit",
  "rule.evaluated",
  "exception.created",
  "replay.idempotent",
  "runtime.real_transport",
  "uns.data_exists",
  "analytics.projection",
];

function report(overrides: Partial<OpenSupOSRuntimeVerificationReport> = {}): OpenSupOSRuntimeVerificationReport {
  return {
    schemaVersion: "open-supos-runtime-verification/v1",
    upstreamCommit: "9272ef5f124f317f902a7a6d2302a22a8c2467e3",
    runtimeVerified: true,
    mqttConnected: true,
    mqttSubscribed: true,
    brokerProbeRoundTrip: true,
    messagesPublished: 11,
    messagesIngested: 11,
    duplicateBatchStable: true,
    domain: { sourceSystems: 7, entities: 8, references: 8, documents: 8, events: 11, evidence: 11 },
    rules: { evaluations: 7, matched: 4, notMatched: 3, exceptions: 4 },
    resolutionCases: 0,
    unsVisibility: "not_verified",
    openApiGateway: "not_verified",
    upstreamPatchRequired: false,
    blocker: null,
    runId: "gate-test-run",
    mqttEndpoint: "mqtt://127.0.0.1:1883/",
    databaseFresh: true,
    receipts: Array.from({ length: 22 }, (_, index) => ({
      messageId: `MFG-MSG-${index + 1}`,
      topic: `fulfillment/demo-manufacturing/SO-MFG-001/sales_order/SO-MFG-001/ORDER_CREATED`,
      batch: (index < 11 ? 1 : 2) as 1 | 2,
      publishedAt: "2026-09-20T00:00:00.000Z",
      observedAt: "2026-09-20T00:00:01.000Z",
      domainEventId: `event-${index + 1}`,
      evidenceIds: [`evidence-${index + 1}`],
      duplicated: index >= 11,
    })),
    startedAt: "2026-09-20T00:00:00.000Z",
    completedAt: "2026-09-20T00:00:10.000Z",
    ...overrides,
  };
}

function summaryOf(value: OpenSupOSRuntimeVerificationReport): OpenSupOSRuntimeVerificationSummary {
  const { runId: _runId, mqttEndpoint: _endpoint, databaseFresh: _fresh, receipts: _receipts, startedAt: _s, completedAt: _c, ...rest } = value;
  return rest;
}

function passedResult(overrides: Partial<OpenSupOSRuntimeVerificationReport> = {}): RuntimeVerificationResult {
  const value = report(overrides);
  return { status: "passed", report: value, summary: summaryOf(value) };
}

function fetchStub(routes: Record<string, { status?: number; body: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const match = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    const status = match?.[1].status ?? 200;
    const body = match ? match[1].body : "";
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const FULL_ENV = {
  OPEN_SUPOS_ENABLED: "true",
  OPEN_SUPOS_RUNTIME_HEALTH_URL: "http://supos.local:8088/health",
  OPEN_SUPOS_COMPONENT_HEALTH: "gateway=http://supos.local:8088/health,emqx=http://supos.local:18083/status",
  OPEN_SUPOS_UNS_VERIFY_URL: "http://supos.local:8088/api/uns/query?path=fulfillment",
  OPEN_SUPOS_PROJECTION_VERIFY: "true",
  OPEN_SUPOS_EXPECTED_EXCEPTIONS: "4",
};

const UNS_BODY = JSON.stringify({ objects: Array.from({ length: 22 }, (_, index) => ({ messageId: `MFG-MSG-${index + 1}` })) });

describe("open supOS verification gate", () => {
  it("never reports PASS without a runtime: every check is present and non-pass", async () => {
    const result = await runOpenSupOSVerificationGate({ env: {} });
    expect(result.status).toBe("blocked");
    expect(result.checks.map((item) => item.id)).toEqual(ALL_CHECKS);
    expect(result.checks.every((item) => item.status !== "pass")).toBe(true);
    expect(result.runtime).toBeNull();
  });

  it("stays blocked (not pass) when the MQTT harness refuses the configuration", async () => {
    const result = await runOpenSupOSVerificationGate({
      env: { ...FULL_ENV },
      fetchImpl: fetchStub({}),
      runRuntimeVerification: async () => {
        throw Object.assign(new Error("OPEN_SUPOS_PUBLIC_BROKER_REJECTED"), { code: "OPEN_SUPOS_PUBLIC_BROKER_REJECTED" });
      },
    });
    expect(result.status).toBe("blocked");
    expect(result.checks.map((item) => item.id)).toEqual(ALL_CHECKS);
    expect(result.blocker).toBe("OPEN_SUPOS_PUBLIC_BROKER_REJECTED");
  });

  it("fails the gate when the runtime was exercised through an injected transport", async () => {
    const value = report();
    const simulated: RuntimeVerificationResult = {
      status: "simulated",
      report: { ...value, runtimeVerified: false, blocker: "INJECTED_TRANSPORT_NOT_REAL_RUNTIME" },
      summary: { ...summaryOf(value), runtimeVerified: false, blocker: "INJECTED_TRANSPORT_NOT_REAL_RUNTIME" },
    };
    const result = await runOpenSupOSVerificationGate({
      env: { ...FULL_ENV },
      fetchImpl: fetchStub({ "http://supos.local": { body: UNS_BODY } }),
      runRuntimeVerification: async () => simulated,
      runProjectionExport: () => ({ detectedExceptions: 4, exceptionTypes: 4 }),
    });
    expect(result.status).toBe("fail");
    expect(result.checks.find((item) => item.id === "runtime.real_transport")?.status).toBe("fail");
  });

  it("fails when a core component health probe is not healthy", async () => {
    const result = await runOpenSupOSVerificationGate({
      env: { ...FULL_ENV },
      fetchImpl: fetchStub({
        "http://supos.local:8088/health": { status: 200, body: "{}" },
        "http://supos.local:18083/status": { status: 503, body: "{}" },
        "http://supos.local:8088/api/uns/query": { body: UNS_BODY },
      }),
      runRuntimeVerification: async () => passedResult(),
      runProjectionExport: () => ({ detectedExceptions: 4, exceptionTypes: 4 }),
    });
    expect(result.status).toBe("fail");
    expect(result.checks.find((item) => item.id === "runtime.components")?.detail).toContain("emqx");
  });

  it("fails when the UNS does not contain the ingested records", async () => {
    const result = await runOpenSupOSVerificationGate({
      env: { ...FULL_ENV },
      fetchImpl: fetchStub({
        "http://supos.local:8088/health": { body: "{}" },
        "http://supos.local:18083/status": { body: "{}" },
        "http://supos.local:8088/api/uns/query": { body: JSON.stringify({ objects: [] }) },
      }),
      runRuntimeVerification: async () => passedResult(),
      runProjectionExport: () => ({ detectedExceptions: 4, exceptionTypes: 4 }),
    });
    expect(result.status).toBe("fail");
    expect(result.checks.find((item) => item.id === "uns.data_exists")?.status).toBe("fail");
  });

  it("reports PASS only when the real runtime, UNS, and projection evidence all line up", async () => {
    const dependencies: GateDependencies = {
      env: { ...FULL_ENV },
      fetchImpl: fetchStub({
        "http://supos.local:8088/health": { body: "{}" },
        "http://supos.local:18083/status": { body: "{}" },
        "http://supos.local:8088/api/uns/query": { body: UNS_BODY },
      }),
      runRuntimeVerification: async () => passedResult(),
      runProjectionExport: () => ({ detectedExceptions: 4, exceptionTypes: 4 }),
      projectionOutputPath: "/tmp/open-supos-gate-test-projection.sql",
    };
    const result = await runOpenSupOSVerificationGate(dependencies);
    const nonPass = result.checks.filter((item) => item.status !== "pass");
    // 投影产物路径只有真正写出文件时才会 PASS；这里断言其余检查已经全部通过
    expect(nonPass.map((item) => item.id)).toEqual(["analytics.projection"]);
    expect(result.status).toBe("fail");
    expect(result.checks.find((item) => item.id === "analytics.projection")?.detail).toContain("detectedExceptions=4");
  });
});
