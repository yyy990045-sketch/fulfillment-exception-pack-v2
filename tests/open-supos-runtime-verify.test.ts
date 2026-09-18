import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runOpenSupOSRuntimeVerification,
  writeRuntimeVerificationReports,
  type RuntimeTransportFactory,
} from "../src/integrations/open-supos/runtime-verify.js";
import type { UnsMessageHandler, UnsTransport } from "../src/integrations/open-supos/transport.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class LoopbackBroker {
  private readonly subscriptions: Array<{ pattern: string; handler: UnsMessageHandler }> = [];

  subscribe(pattern: string, handler: UnsMessageHandler) {
    this.subscriptions.push({ pattern, handler });
  }

  async publish(topic: string, payload: string) {
    for (const subscription of this.subscriptions) {
      if (this.matches(subscription.pattern, topic)) await subscription.handler(topic, payload);
    }
  }

  private matches(pattern: string, topic: string) {
    const expected = pattern.split("/");
    const actual = topic.split("/");
    return expected.length === actual.length && expected.every((segment, index) => segment === "+" || segment === actual[index]);
  }
}

class LoopbackTransport implements UnsTransport {
  constructor(private readonly broker: LoopbackBroker) {}

  async connect() {}
  async disconnect() {}
  async subscribe(topicPattern: string, handler: UnsMessageHandler) {
    this.broker.subscribe(topicPattern, handler);
  }
  async publish(topic: string, payload: string) {
    await this.broker.publish(topic, payload);
  }
}

function runtimeTestEnv(databasePath: string) {
  return {
    OPEN_SUPOS_ENABLED: "true",
    OPEN_SUPOS_MQTT_URL: "mqtt://user:secret@127.0.0.1:1883",
    OPEN_SUPOS_UPSTREAM_COMMIT: "9272ef5f124f317f902a7a6d2302a22a8c2467e3",
    OPEN_SUPOS_RUNTIME_CONFIRMED: "true",
    PACK_STORE_DB: databasePath,
    OPEN_SUPOS_UNS_VISIBILITY: "not_verified",
    OPEN_SUPOS_OPEN_API_STATUS: "not_verified",
  };
}

describe("Open supOS runtime verifier orchestration", () => {
  it("stays disabled without explicit enablement", async () => {
    const result = await runOpenSupOSRuntimeVerification({
      env: { OPEN_SUPOS_ENABLED: "false" },
      transportFactory: () => {
        throw new Error("transport_factory_must_not_run");
      },
    });
    expect(result).toEqual({ status: "disabled" });
  });

  it("fails closed on provenance, public broker, and client ID conflicts", async () => {
    const base = {
      OPEN_SUPOS_ENABLED: "true",
      OPEN_SUPOS_MQTT_URL: "mqtt://127.0.0.1:1883",
      OPEN_SUPOS_UPSTREAM_COMMIT: "9272ef5f124f317f902a7a6d2302a22a8c2467e3",
      OPEN_SUPOS_RUNTIME_CONFIRMED: "true",
    };
    await expect(runOpenSupOSRuntimeVerification({
      env: { ...base, OPEN_SUPOS_UPSTREAM_COMMIT: "b".repeat(40) },
    })).rejects.toMatchObject({ code: "OPEN_SUPOS_UPSTREAM_COMMIT_MISMATCH" });
    await expect(runOpenSupOSRuntimeVerification({
      env: { ...base, OPEN_SUPOS_MQTT_URL: "mqtt://broker.emqx.io:1883" },
    })).rejects.toMatchObject({ code: "OPEN_SUPOS_PUBLIC_BROKER_REJECTED" });
    await expect(runOpenSupOSRuntimeVerification({
      env: {
        ...base,
        OPEN_SUPOS_MQTT_CLIENT_ID_SUBSCRIBER: "same-client",
        OPEN_SUPOS_MQTT_CLIENT_ID_PUBLISHER: "same-client",
      },
    })).rejects.toMatchObject({ code: "OPEN_SUPOS_MQTT_CLIENT_ID_CONFLICT" });
  });

  it("runs the manifest through separate transports and rebuilds the fresh domain", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fep-runtime-verify-"));
    tempDirectories.push(directory);
    const databasePath = join(directory, "runtime.sqlite");
    const broker = new LoopbackBroker();
    const transportFactory: RuntimeTransportFactory = () => new LoopbackTransport(broker);

    const result = await runOpenSupOSRuntimeVerification({
      env: runtimeTestEnv(databasePath),
      runId: "loopback-run",
      timeoutMs: 1_000,
      transportFactory,
    });

    expect(result.status).toBe("simulated");
    if (result.status !== "simulated") return;
    expect(result.summary).toMatchObject({
      runtimeVerified: false,
      mqttConnected: true,
      mqttSubscribed: true,
      brokerProbeRoundTrip: true,
      messagesPublished: 11,
      messagesIngested: 11,
      duplicateBatchStable: true,
      domain: {
        sourceSystems: 7,
        entities: 8,
        references: 8,
        documents: 8,
        events: 11,
        evidence: 11,
      },
      rules: {
        evaluations: 7,
        matched: 4,
        notMatched: 3,
        exceptions: 4,
      },
      resolutionCases: 0,
      blocker: "INJECTED_TRANSPORT_NOT_REAL_RUNTIME",
    });
    expect(result.report.receipts).toHaveLength(22);

    const rawPath = join(directory, "report.json");
    const summaryPath = join(directory, "summary.json");
    writeRuntimeVerificationReports({ ...result.report, runtimeVerified: true, blocker: null }, { raw: rawPath, summary: summaryPath });
    expect(readFileSync(rawPath, "utf8")).not.toContain("secret");
    expect(readFileSync(summaryPath, "utf8")).not.toContain("secret");
    expect(JSON.parse(readFileSync(summaryPath, "utf8"))).toMatchObject({ runtimeVerified: true });
  });
});
