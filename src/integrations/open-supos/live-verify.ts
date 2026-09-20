/**
 * open supOS live A/B 验证（需要真实运行时）。
 *
 * 与 contract 模式共用同一份断言实现（`verifyOpenSupOSCaseFlow`），差别只有消息来源：
 *   - 真实 MQTT broker（open supOS EMQX）订阅者把消息灌进 `OpenSupOSUnsQueue`
 *   - 之后仍然走 `OpenSuposInboundConnector → SourceRecordEnvelope → runInboundSync`
 *
 * 写入目标是业务库（PACK_STORE_DIR），这样第 18-20 步的 analysis projection → Superset
 * 才是同一条数据。幂等由 Source Ledger 保证：重复执行不会重复产生异常。
 */
import { randomUUID } from "node:crypto";
import { V2SqliteStore } from "../../domain/v2/index.js";
import { openV2SqliteStore } from "../../domain/v2/runtime-store.js";
import { buildOpenSupOSAbCases, type OpenSupOSAbCase } from "./ab-cases.js";
import { OpenSupOSUnsQueue } from "./connector.js";
import { OpenSuposSourceAdapter } from "./connector.js";
import { verifyOpenSupOSCaseFlow, type OpenSupOSAbCaseEvidence, type OpenSupOSAbReplayEvidence } from "./contract-verify.js";
import { requireEnabledOpenSupOSRuntimeEnv } from "./runtime-verify.js";
import { OpenSupOSMqttTransport, type UnsTransport } from "./transport.js";
import type { OpenSupOSUnsEnvelope } from "./types.js";

const TOPIC_PATTERN = "fulfillment/+/+/+/+/+";

export type OpenSupOSLiveAbReport = {
  schemaVersion: "open-supos-live-ab/v1";
  status: "pass" | "fail" | "blocked";
  mqttEndpoint: string;
  brokerReachable: boolean;
  mqttPublished: number;
  mqttReceived: number;
  cases: OpenSupOSAbCaseEvidence[];
  replay: OpenSupOSAbReplayEvidence | null;
  failures: string[];
  blocker: string | null;
  startedAt: string;
  completedAt: string;
};

export type OpenSupOSLiveAbOptions = {
  env?: Record<string, string | undefined>;
  transportFactory?: (input: { role: string; clientId: string }) => UnsTransport;
  store?: V2SqliteStore;
  now?: () => Date;
  timeoutMs?: number;
};

function redact(value: string | undefined) {
  if (!value) return "<unconfigured>";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<configured>";
  }
}

async function waitFor(check: () => boolean, timeoutMs: number, code: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (check()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(code);
}

export async function runOpenSupOSLiveAbVerification(
  options: OpenSupOSLiveAbOptions = {},
): Promise<OpenSupOSLiveAbReport> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const timeoutMs = options.timeoutMs ?? Number(env.OPEN_SUPOS_VERIFY_TIMEOUT_MS || 60_000);
  const cases = buildOpenSupOSAbCases();
  const failures: string[] = [];
  const transports: UnsTransport[] = [];
  let published = 0;
  let received = 0;

  const report: OpenSupOSLiveAbReport = {
    schemaVersion: "open-supos-live-ab/v1",
    status: "blocked",
    mqttEndpoint: redact(env.OPEN_SUPOS_MQTT_URL),
    brokerReachable: false,
    mqttPublished: 0,
    mqttReceived: 0,
    cases: [],
    replay: null,
    failures,
    blocker: null,
    startedAt,
    completedAt: startedAt,
  };

  let config: { url: string; upstreamCommit: string };
  try {
    config = requireEnabledOpenSupOSRuntimeEnv(env);
  } catch (error) {
    report.blocker = error instanceof Error ? error.message : "OPEN_SUPOS_RUNTIME_ENV_REQUIRED";
    return report;
  }

  const store = options.store ?? openV2SqliteStore();
  const transportFactory = options.transportFactory ?? ((input) => new OpenSupOSMqttTransport({
    url: config.url,
    username: env.OPEN_SUPOS_MQTT_USERNAME,
    password: env.OPEN_SUPOS_MQTT_PASSWORD,
    clientId: input.clientId,
  }));
  const runId = randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const adapter = new OpenSuposSourceAdapter(store);

  const queueFor = (testCase: OpenSupOSAbCase, stream: "initial" | "replay") => async () => {
    const queue = new OpenSupOSUnsQueue();
    const subscriber = transportFactory({ role: `${stream}-subscriber`, clientId: `ouns-${stream}-sub-${runId}` });
    const publisher = transportFactory({ role: `${stream}-publisher`, clientId: `ouns-${stream}-pub-${runId}` });
    transports.push(subscriber, publisher);
    await subscriber.connect();
    await subscriber.subscribe(TOPIC_PATTERN, (topic, payload) => {
      try {
        const envelope = JSON.parse(payload) as OpenSupOSUnsEnvelope;
        if (envelope?.context?.businessKey !== testCase.businessKey) return;
        if (queue.push({ topic, payload, envelope })) received += 1;
      } catch {
        // 非本 case 的报文忽略；解析失败不会污染本 case 的结果
      }
    });
    await publisher.connect();
    for (const message of testCase.messages) {
      await publisher.publish(message.topic, JSON.stringify(message.envelope));
      published += 1;
    }
    await waitFor(() => queue.pending >= testCase.messages.length, timeoutMs, `OPEN_SUPOS_LIVE_AB_INGEST_TIMEOUT:${testCase.caseId}:${stream}`);
    return queue;
  };

  try {
    for (const testCase of cases) {
      // 一次调用即覆盖：首次摄入 → 重放（重新订阅 + 重新 publish，走真实 broker）→ checkpoint
      const result = await verifyOpenSupOSCaseFlow({
        testCase,
        store,
        adapter,
        now,
        queueFor: async (stream) => queueFor(testCase, stream)(),
      });
      report.cases.push(result.evidence);
      report.replay = result.replay;
      for (const failure of result.evidence.failures) failures.push(`${testCase.caseId}:${failure}`);
      for (const failure of result.replay.failures) failures.push(`${testCase.caseId}:replay:${failure}`);
    }
    report.brokerReachable = received > 0;
    report.mqttPublished = published;
    report.mqttReceived = received;
    report.status = failures.length === 0 && received > 0 ? "pass" : "fail";
    if (failures.length === 0 && received === 0) report.blocker = "OPEN_SUPOS_LIVE_NO_MQTT_TRAFFIC";
  } catch (error) {
    report.status = "fail";
    report.blocker = error instanceof Error ? error.message : "OPEN_SUPOS_LIVE_AB_FAILED";
  } finally {
    for (const transport of transports) {
      try {
        await transport.disconnect();
      } catch {
        // 关闭失败不改变验收结论
      }
    }
    report.completedAt = now().toISOString();
  }
  return report;
}
