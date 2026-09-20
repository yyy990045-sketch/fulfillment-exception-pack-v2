import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_CHECK_ORDER,
  LIVE_CHECK_ORDER,
  runOpenSupOSVerificationGate,
  type GateDependencies,
} from "../src/integrations/open-supos/verify-cli.js";
import type { OpenSupOSAbCaseEvidence, OpenSupOSAbContractReport, OpenSupOSAbReplayEvidence } from "../src/integrations/open-supos/contract-verify.js";
import type { OpenSupOSLiveAbReport } from "../src/integrations/open-supos/live-verify.js";

const CONTRACT_IDS = CONTRACT_CHECK_ORDER.map(([id]) => id);
const LIVE_IDS = LIVE_CHECK_ORDER.map(([id]) => id);

function caseEvidence(overrides: Partial<OpenSupOSAbCaseEvidence> = {}): OpenSupOSAbCaseEvidence {
  return {
    caseId: "normal-order",
    label: "normal",
    contextId: "ctx-normal",
    published: 11,
    ingested: 11,
    recordsRead: 11,
    recordsCommitted: 11,
    recordsDuplicate: 0,
    ledgerRecords: 11,
    events: 11,
    evidenceRows: 11,
    evaluations: 7,
    matchedExceptionRules: 0,
    notMatchedRules: 7,
    exceptions: 0,
    exceptionCodes: [],
    matchedRuleCodes: [],
    provenance: { sourceSystems: ["ERP-DEMO"], locatorNamespace: "fulfillment/demo-manufacturing", locatorTopicSample: "fulfillment/demo-manufacturing/SO-AB-N-001/...", ledgerEvidenceRefs: 11, ledgerCanonicalRefs: 11 },
    expectation: { evaluations: 7, matchedExceptionRules: 0, exceptions: 0, exceptionCodes: [] },
    passed: true,
    failures: [],
    ...overrides,
  };
}

const REPLAY_PASSING: OpenSupOSAbReplayEvidence = {
  caseId: "exception-order",
  duplicateInput: 11,
  duplicateLedgerRecords: 0,
  newEvents: 0,
  newExceptions: 0,
  exceptionsBefore: 1,
  exceptionsAfter: 1,
  checkpointRecordsRead: 0,
  passed: true,
  failures: [],
};

function liveReport(overrides: Partial<OpenSupOSLiveAbReport> = {}): OpenSupOSLiveAbReport {
  const normal = caseEvidence();
  const exception = caseEvidence({
    caseId: "exception-order",
    label: "exception",
    contextId: "ctx-exception",
    matchedExceptionRules: 1,
    notMatchedRules: 6,
    exceptions: 1,
    exceptionCodes: ["ORDER_PRODUCTION_COMPLETION_SHORTFALL"],
    matchedRuleCodes: ["rule-order-production-completion-shortfall"],
    expectation: { evaluations: 7, matchedExceptionRules: 1, exceptions: 1, exceptionCodes: ["ORDER_PRODUCTION_COMPLETION_SHORTFALL"] },
  });
  return {
    schemaVersion: "open-supos-live-ab/v1",
    status: "pass",
    mqttEndpoint: "mqtt://supos.local:1883/",
    brokerReachable: true,
    mqttPublished: 44,
    mqttReceived: 44,
    cases: [normal, exception],
    replay: REPLAY_PASSING,
    failures: [],
    blocker: null,
    startedAt: "2026-09-20T00:00:00.000Z",
    completedAt: "2026-09-20T00:00:30.000Z",
    ...overrides,
  };
}

function contractReport(): OpenSupOSAbContractReport {
  const normal = caseEvidence();
  const exception = caseEvidence({
    caseId: "exception-order",
    matchedExceptionRules: 1,
    notMatchedRules: 6,
    exceptions: 1,
    exceptionCodes: ["ORDER_PRODUCTION_COMPLETION_SHORTFALL"],
  });
  return {
    schemaVersion: "open-supos-ab-contract/v1",
    verdict: "LOCAL_CONTRACT_VERIFIED",
    status: "pass",
    entrypoint: {
      connectorId: "open-supos-uns-inbound",
      mappingId: "open-supos-uns",
      mappingVersion: "1.0.0",
      installationId: "open-supos-uns-installation",
      recordType: "OPEN_SUPOS.UNS.EVENT",
    },
    cases: [normal, exception],
    replay: REPLAY_PASSING,
    failures: [],
    generatedAt: "2026-09-20T00:00:00.000Z",
  };
}

function writeReceipt(input: Partial<{ projectionReloaded: boolean; supersetVerifyEmbedPass: boolean; dashboardObserved: boolean }>) {
  const directory = mkdtempSync(join(tmpdir(), "fep-open-supos-receipt-"));
  const path = join(directory, "superset-receipt.json");
  writeFileSync(path, JSON.stringify({
    projectionReloaded: true,
    supersetVerifyEmbedPass: true,
    dashboardObserved: true,
    factRows: { fact_exception_type: 4 },
    observedAt: "2026-09-20T00:05:00.000Z",
    ...input,
  }), "utf8");
  return path;
}

function writeProjectionArtifact() {
  const directory = mkdtempSync(join(tmpdir(), "fep-open-supos-projection-"));
  const path = join(directory, "projection.sql");
  writeFileSync(path, "-- open supOS A/B projection fixture\n", "utf8");
  return path;
}

const LIVE_ENV = {
  OPEN_SUPOS_ENABLED: "true",
  OPEN_SUPOS_RUNTIME_HEALTH_URL: "http://supos.local:8088/health",
  OPEN_SUPOS_UNS_VERIFY_URL: "http://supos.local:8088/api/uns/query",
  OPEN_SUPOS_PROJECTION_VERIFY: "true",
  OPEN_SUPOS_EXPECTED_EXCEPTIONS: "1",
};

function fetchStub(routes: Record<string, number>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const match = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    return new Response(JSON.stringify({ objects: [{ caseId: "normal-order" }, { caseId: "exception-order" }] }), {
      status: match?.[1] ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("open supOS verification gate — contract mode", () => {
  it("verifies the A/B contract locally and reports LOCAL_CONTRACT_VERIFIED", async () => {
    const report = await runOpenSupOSVerificationGate({ mode: "contract" });
    expect(report.checks.map((item) => item.id)).toEqual(CONTRACT_IDS);
    expect(report.status).toBe("pass");
    expect(report.verdict).toBe("LOCAL_CONTRACT_VERIFIED");
    expect(report.checks.every((item) => item.status === "pass")).toBe(true);
  });

  it("never upgrades a live verdict from contract mode", async () => {
    const report = await runOpenSupOSVerificationGate({ mode: "contract" });
    expect(report.verdict).not.toBe("REMOTE_RUNTIME_VERIFIED");
    expect(report.live).toBeNull();
  });

  it("fails closed when the contract result does not match expectations", async () => {
    const broken = contractReport();
    broken.cases[0]!.exceptions = 2;
    const report = await runOpenSupOSVerificationGate({
      mode: "contract",
      runContract: async () => broken,
    });
    expect(report.status).toBe("fail");
    expect(report.checks.find((item) => item.id === "contract.case_a_normal")?.status).toBe("fail");
  });

  it("marks every contract check failed when the runner throws", async () => {
    const report = await runOpenSupOSVerificationGate({
      mode: "contract",
      runContract: async () => {
        throw new Error("CONTRACT_BOOM");
      },
    });
    expect(report.status).toBe("fail");
    expect(report.checks).toHaveLength(CONTRACT_IDS.length);
    expect(report.checks.every((item) => item.status !== "pass")).toBe(true);
  });
});

describe("open supOS verification gate — live mode", () => {
  it("stays BLOCKED on this host: no runtime evidence, no PASS", async () => {
    const report = await runOpenSupOSVerificationGate({ mode: "live", env: {}, writeEvidence: false });
    expect(report.checks.map((item) => item.id)).toEqual(LIVE_IDS);
    expect(report.status).toBe("blocked");
    expect(report.verdict).toBe("BLOCKED");
    expect(report.checks.some((item) => item.status === "pass")).toBe(false);
  });

  it("keeps blocked steps visible and never claims VERIFIED without receipts", async () => {
    const report = await runOpenSupOSVerificationGate({
      mode: "live",
      env: LIVE_ENV,
      fetchImpl: fetchStub({ "http://supos.local:8088/health": 200 }),
      runLive: async () => liveReport(),
      runProjectionExport: () => ({ detectedExceptions: 1, exceptionTypes: 4 }),
      projectionOutputPath: writeProjectionArtifact(),
      supersetReceiptPath: join(tmpdir(), "fep-does-not-exist", "superset-receipt.json"),
      writeEvidence: false,
    });
    expect(report.status).toBe("blocked");
    expect(report.verdict).not.toBe("REMOTE_RUNTIME_VERIFIED");
    expect(report.checks.find((item) => item.id === "superset.projection_reloaded")?.status).toBe("blocked");
    expect(report.checks.find((item) => item.id === "superset.dashboard_reflects_data")?.status).toBe("blocked");
  });

  it("fails when the exception case does not produce the expected exception", async () => {
    const broken = liveReport();
    broken.cases = broken.cases.map((item) => item.caseId === "exception-order"
      ? { ...item, exceptions: 0, exceptionCodes: [], matchedExceptionRules: 0 }
      : item);
    const report = await runOpenSupOSVerificationGate({
      mode: "live",
      env: LIVE_ENV,
      fetchImpl: fetchStub({ "http://supos.local:8088/health": 200 }),
      runLive: async () => broken,
      runProjectionExport: () => ({ detectedExceptions: 1, exceptionTypes: 4 }),
      projectionOutputPath: writeProjectionArtifact(),
      supersetReceiptPath: writeReceipt({}),
      writeEvidence: false,
    });
    expect(report.status).toBe("fail");
    expect(report.checks.find((item) => item.id === "case_b.expected_exception")?.status).toBe("fail");
  });

  it("reaches REMOTE_RUNTIME_VERIFIED only when runtime, A/B, replay and Superset evidence all exist", async () => {
    const dependencies: GateDependencies = {
      mode: "live",
      env: LIVE_ENV,
      fetchImpl: fetchStub({ "http://supos.local:8088/health": 200, "http://supos.local:8088/api/uns/query": 200 }),
      runLive: async () => liveReport(),
      runProjectionExport: () => ({ detectedExceptions: 1, exceptionTypes: 4 }),
      supersetReceiptPath: writeReceipt({}),
      projectionOutputPath: writeProjectionArtifact(),
      writeEvidence: false,
    };
    const report = await runOpenSupOSVerificationGate(dependencies);
    expect(report.checks.filter((item) => item.status !== "pass").map((item) => item.id)).toEqual([]);
    expect(report.status).toBe("pass");
    expect(report.verdict).toBe("REMOTE_RUNTIME_VERIFIED");
  });
});
