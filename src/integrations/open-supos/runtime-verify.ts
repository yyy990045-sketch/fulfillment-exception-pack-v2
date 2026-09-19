import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  MANUFACTURING_RULE_DEFINITIONS,
  MANUFACTURING_RULE_VERSIONS,
  V2SqliteStore,
  evaluateContextRules,
  type SqliteDatabaseLike,
} from "../../domain/v2/index.js";
import { OpenSupOSAdapter } from "./adapter.js";
import { buildSoMfg001UnsMessages } from "./manifests/so-mfg-001.js";
import { mapUnsEnvelopeToDomainPlan } from "./mapper.js";
import { startConfiguredOpenSupOSInbound } from "./runtime.js";
import { OpenSupOSMqttTransport, type UnsTransport } from "./transport.js";
import type { OpenSupOSInboundResult } from "./types.js";
import { manufacturingFulfillmentPack, registerBuiltInSolutionPacks } from "../../solution-packs/index.js";

const TENANT_ID = "demo-manufacturing";
const DEFAULT_TIMEOUT_MS = 60_000;
const RAW_REPORT_PATH = "data/runtime/open-supos-verification.json";
const SUMMARY_PATH = "docs/competition/runtime/open-supos-5b1-summary.json";
const AUDITED_UPSTREAM_COMMIT = "9272ef5f124f317f902a7a6d2302a22a8c2467e3";
const PUBLIC_BROKER_HOSTS = new Set(["broker.emqx.io", "test.mosquitto.org", "broker.hivemq.com"]);

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };

export type RuntimeVerificationStore = {
  store: V2SqliteStore;
  close(): void;
};

export type RuntimeTransportRole = "probe-subscriber" | "probe-publisher" | "subscriber" | "publisher";

export type RuntimeTransportFactory = (input: {
  role: RuntimeTransportRole;
  url: string;
  username?: string;
  password?: string;
  clientId: string;
}) => UnsTransport;

export type RuntimeReceipt = {
  messageId: string;
  topic: string;
  batch: 1 | 2;
  publishedAt: string;
  observedAt: string;
  domainEventId: string;
  evidenceIds: string[];
  duplicated: boolean;
};

export type OpenSupOSRuntimeVerificationSummary = {
  schemaVersion: "open-supos-runtime-verification/v1";
  upstreamCommit: string | null;
  runtimeVerified: boolean;
  mqttConnected: boolean;
  mqttSubscribed: boolean;
  brokerProbeRoundTrip: boolean;
  messagesPublished: number;
  messagesIngested: number;
  duplicateBatchStable: boolean;
  domain: {
    sourceSystems: number;
    entities: number;
    references: number;
    documents: number;
    events: number;
    evidence: number;
  };
  rules: {
    evaluations: number;
    matched: number;
    notMatched: number;
    exceptions: number;
  };
  resolutionCases: number;
  unsVisibility: "automatic" | "requires_provisioning" | "not_verified";
  openApiGateway: "working" | "partial" | "broken" | "not_verified";
  upstreamPatchRequired: boolean;
  blocker: string | null;
};

export type OpenSupOSRuntimeVerificationReport = OpenSupOSRuntimeVerificationSummary & {
  runId: string;
  mqttEndpoint: string;
  databaseFresh: boolean;
  receipts: RuntimeReceipt[];
  startedAt: string;
  completedAt: string;
};

export type RuntimeVerificationOptions = {
  env?: Record<string, string | undefined>;
  runId?: string;
  timeoutMs?: number;
  transportFactory?: RuntimeTransportFactory;
  storeFactory?: (databasePath: string) => RuntimeVerificationStore;
  now?: () => Date;
};

export type RuntimeVerificationResult =
  | { status: "disabled" }
  | { status: "simulated"; report: OpenSupOSRuntimeVerificationReport; summary: OpenSupOSRuntimeVerificationSummary }
  | { status: "passed"; report: OpenSupOSRuntimeVerificationReport; summary: OpenSupOSRuntimeVerificationSummary };

export class RuntimeVerificationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RuntimeVerificationError";
  }
}

function defaultTransportFactory(input: Parameters<RuntimeTransportFactory>[0]) {
  return new OpenSupOSMqttTransport({
    url: input.url,
    username: input.username,
    password: input.password,
    clientId: input.clientId,
  });
}

function defaultStoreFactory(databasePath: string): RuntimeVerificationStore {
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new RuntimeVerificationError("RUNTIME_VERIFY_REQUIRES_NODE_22_5_OR_NEWER");
  const database = new builtin.DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return {
    store: new V2SqliteStore(database),
    close: () => database.close?.(),
  };
}

function redactMqttUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "<configured>";
  }
}

function requireEnabledEnv(env: Record<string, string | undefined>) {
  const url = env.OPEN_SUPOS_MQTT_URL?.trim();
  if (!url) throw new RuntimeVerificationError("OPEN_SUPOS_MQTT_URL_REQUIRED");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new RuntimeVerificationError("OPEN_SUPOS_MQTT_URL_INVALID");
  }
  if (!["mqtt:", "mqtts:", "ws:", "wss:"].includes(parsedUrl.protocol)) {
    throw new RuntimeVerificationError("OPEN_SUPOS_MQTT_PROTOCOL_INVALID");
  }
  if (PUBLIC_BROKER_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new RuntimeVerificationError("OPEN_SUPOS_PUBLIC_BROKER_REJECTED");
  }
  const upstreamCommit = env.OPEN_SUPOS_UPSTREAM_COMMIT?.trim();
  if (!upstreamCommit) {
    throw new RuntimeVerificationError("OPEN_SUPOS_UPSTREAM_COMMIT_REQUIRED");
  }
  if (upstreamCommit.toLowerCase() !== AUDITED_UPSTREAM_COMMIT) {
    throw new RuntimeVerificationError("OPEN_SUPOS_UPSTREAM_COMMIT_MISMATCH");
  }
  if (env.OPEN_SUPOS_RUNTIME_CONFIRMED !== "true") {
    throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_CONFIRMATION_REQUIRED");
  }
  return { url, upstreamCommit };
}

function freshDatabasePath(env: Record<string, string | undefined>, runId: string) {
  const configured = env.PACK_STORE_DB?.trim();
  const path = resolve(configured || `data/runtime/open-supos-5b-${runId}.sqlite`);
  if (existsSync(path)) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_DB_NOT_FRESH");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function clientId(env: Record<string, string | undefined>, role: RuntimeTransportRole, runId: string) {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  const prefix = role.includes("publisher") ? "fep5b1pub" : "fep5b1sub";
  const configured = role === "publisher"
    ? env.OPEN_SUPOS_MQTT_CLIENT_ID_PUBLISHER
    : role === "subscriber"
      ? env.OPEN_SUPOS_MQTT_CLIENT_ID_SUBSCRIBER
      : undefined;
  return `${configured || `${prefix}-${role.replace("-", "")}`}-${suffix}`;
}

function assertDistinctClientIds(env: Record<string, string | undefined>, runId: string) {
  if (clientId(env, "subscriber", runId) === clientId(env, "publisher", runId)) {
    throw new RuntimeVerificationError("OPEN_SUPOS_MQTT_CLIENT_ID_CONFLICT");
  }
}

async function waitFor<T>(input: {
  timeoutMs: number;
  intervalMs?: number;
  timeoutCode: string;
  read: () => T | undefined;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= input.timeoutMs) {
    const value = input.read();
    if (value !== undefined) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, input.intervalMs ?? 250));
  }
  throw new RuntimeVerificationError(input.timeoutCode);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RuntimeVerificationError(code)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function disconnectQuietly(transport?: UnsTransport) {
  try {
    await transport?.disconnect();
  } catch {
    // The verification result owns the failure; shutdown errors must not mask it.
  }
}

async function probeBroker(input: {
  env: Record<string, string | undefined>;
  runId: string;
  timeoutMs: number;
  transportFactory: RuntimeTransportFactory;
}) {
  const { env, runId, timeoutMs, transportFactory } = input;
  const topic = `fulfillment-runtime-probe/${runId}`;
  const payload = JSON.stringify({ probe: runId, observedAt: new Date().toISOString() });
  let received: string | undefined;
  const subscriber = transportFactory({
    role: "probe-subscriber",
    url: env.OPEN_SUPOS_MQTT_URL!,
    username: env.OPEN_SUPOS_MQTT_USERNAME,
    password: env.OPEN_SUPOS_MQTT_PASSWORD,
    clientId: clientId(env, "probe-subscriber", runId),
  });
  const publisher = transportFactory({
    role: "probe-publisher",
    url: env.OPEN_SUPOS_MQTT_URL!,
    username: env.OPEN_SUPOS_MQTT_USERNAME,
    password: env.OPEN_SUPOS_MQTT_PASSWORD,
    clientId: clientId(env, "probe-publisher", runId),
  });
  try {
    await subscriber.connect();
    await withTimeout(subscriber.subscribe(topic, (receivedTopic, receivedPayload) => {
      if (receivedTopic === topic) received = receivedPayload;
    }), timeoutMs, "MQTT_SUBSCRIBE_TIMEOUT");
    await publisher.connect();
    await withTimeout(publisher.publish(topic, payload), timeoutMs, "MQTT_PROBE_PUBLISH_TIMEOUT");
    await waitFor({
      timeoutMs,
      timeoutCode: "MQTT_PROBE_RECEIVE_TIMEOUT",
      read: () => received === payload ? true : undefined,
    });
  } finally {
    await disconnectQuietly(publisher);
    await disconnectQuietly(subscriber);
  }
}

function evidenceFor(
  replay: ReturnType<V2SqliteStore["replayContext"]>,
  entityType: string,
  field: string,
) {
  const entityIds = new Set(replay.entities.filter((entity) => entity.entityType === entityType).map((entity) => entity.id));
  return replay.evidence.find((item) => Boolean(item.entityId && entityIds.has(item.entityId)) && item.field === field);
}

function assertFact(
  replay: ReturnType<V2SqliteStore["replayContext"]>,
  entityType: string,
  field: string,
  expected: number,
) {
  if (evidenceFor(replay, entityType, field)?.value !== expected) {
    throw new RuntimeVerificationError(`OPEN_SUPOS_RUNTIME_FACT_MISMATCH:${entityType}.${field}`);
  }
}

function assertLineage(
  replay: ReturnType<V2SqliteStore["replayContext"]>,
  input: {
    field: string;
    sourceSystemId: string;
    entityType: string;
    entityBusinessKey: string;
    eventType: string;
    externalDocumentId: string;
    sourceVersion: string;
  },
) {
  const evidence = replay.evidence.find((item) => item.field === input.field &&
    replay.entities.some((entity) => entity.id === item.entityId && entity.entityType === input.entityType && entity.businessKey === input.entityBusinessKey));
  if (!evidence || evidence.sourceSystemId !== input.sourceSystemId) {
    throw new RuntimeVerificationError(`OPEN_SUPOS_RUNTIME_LINEAGE_MISMATCH:${input.field}`);
  }
  const event = replay.events.find((item) => item.id === evidence.eventId);
  const document = replay.documents.find((item) => item.id === evidence.sourceDocumentId);
  if (
    event?.eventType !== input.eventType ||
    event.entityId !== evidence.entityId ||
    document?.sourceSystemId !== input.sourceSystemId ||
    document.externalDocumentId !== input.externalDocumentId ||
    document.version !== input.sourceVersion
  ) {
    throw new RuntimeVerificationError(`OPEN_SUPOS_RUNTIME_LINEAGE_MISMATCH:${input.field}`);
  }
  return evidence;
}

function assertDomainState(
  replay: ReturnType<V2SqliteStore["replayContext"]>,
) {
  if (!replay.context) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_CONTEXT_MISSING");
  if (replay.sourceSystems.length !== 7) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_SOURCE_SYSTEM_COUNT_MISMATCH");
  if (replay.entities.length !== 8) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_ENTITY_COUNT_MISMATCH");
  if (replay.entityReferences.length !== 8) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_REFERENCE_COUNT_MISMATCH");
  if (replay.documents.length !== 8) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_DOCUMENT_COUNT_MISMATCH");
  if (replay.events.length !== 11) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_EVENT_COUNT_MISMATCH");
  if (replay.evidence.length !== 11) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_EVIDENCE_COUNT_MISMATCH");

  assertFact(replay, "quote", "qty", 100);
  assertFact(replay, "sales_order", "qty", 100);
  assertFact(replay, "production_order", "plannedQty", 100);
  assertFact(replay, "production_order", "completedQty", 100);
  assertFact(replay, "quality_event", "inspectedQty", 100);
  assertFact(replay, "quality_event", "passedQty", 96);
  assertFact(replay, "quality_event", "failedQty", 4);
  assertFact(replay, "shipment", "qty", 96);
  assertFact(replay, "receivable", "amount", 100000);
  assertFact(replay, "payment", "amount", 80000);
  assertFact(replay, "complaint", "claimedReceivedQty", 80);

  const completed = assertLineage(replay, {
    field: "completedQty",
    sourceSystemId: "MES-DEMO",
    entityType: "production_order",
    entityBusinessKey: "MO-MFG-001",
    eventType: "PRODUCTION_COMPLETED",
    externalDocumentId: "MO-MFG-001",
    sourceVersion: "v1",
  });
  const passed = assertLineage(replay, {
    field: "passedQty",
    sourceSystemId: "QMS-DEMO",
    entityType: "quality_event",
    entityBusinessKey: "QC-MFG-001",
    eventType: "QUALITY_PASSED",
    externalDocumentId: "QC-MFG-001",
    sourceVersion: "v1",
  });
  const failed = assertLineage(replay, {
    field: "failedQty",
    sourceSystemId: "QMS-DEMO",
    entityType: "quality_event",
    entityBusinessKey: "QC-MFG-001",
    eventType: "QUALITY_FAILED",
    externalDocumentId: "QC-MFG-001",
    sourceVersion: "v1",
  });
  const started = assertLineage(replay, {
    field: "plannedQty",
    sourceSystemId: "MES-DEMO",
    entityType: "production_order",
    entityBusinessKey: "MO-MFG-001",
    eventType: "PRODUCTION_STARTED",
    externalDocumentId: "MO-MFG-001",
    sourceVersion: "v1",
  });
  const inspected = assertLineage(replay, {
    field: "inspectedQty",
    sourceSystemId: "QMS-DEMO",
    entityType: "quality_event",
    entityBusinessKey: "QC-MFG-001",
    eventType: "QUALITY_INSPECTED",
    externalDocumentId: "QC-MFG-001",
    sourceVersion: "v1",
  });
  if (started.sourceDocumentId !== completed.sourceDocumentId) {
    throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_PRODUCTION_DOCUMENT_SHARING_MISMATCH");
  }
  if (inspected.sourceDocumentId !== passed.sourceDocumentId || passed.sourceDocumentId !== failed.sourceDocumentId) {
    throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_QUALITY_DOCUMENT_SHARING_MISMATCH");
  }
  return {
    sourceSystems: replay.sourceSystems.length,
    entities: replay.entities.length,
    references: replay.entityReferences.length,
    documents: replay.documents.length,
    events: replay.events.length,
    evidence: replay.evidence.length,
  };
}

function provisionManufacturingRuleCatalog(store: V2SqliteStore) {
  registerBuiltInSolutionPacks();
  manufacturingFulfillmentPack.install(store, TENANT_ID, "runtime-verifier");
  for (const definition of MANUFACTURING_RULE_DEFINITIONS) store.saveRuleDefinition(definition);
  for (const version of MANUFACTURING_RULE_VERSIONS) {
    store.saveRuleVersion(version);
    store.retireRuleVersionsExcept(version.tenantId, version.ruleId, version.id);
  }
}

function runManufacturingRules(store: V2SqliteStore, contextId: string) {
  provisionManufacturingRuleCatalog(store);
  const evaluated = evaluateContextRules(store, TENANT_ID, contextId);
  if (!evaluated) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_CONTEXT_MISSING");
  const matched = evaluated.results.filter((item) => item.evaluation.status === "matched").length;
  const notMatched = evaluated.results.filter((item) => item.evaluation.status === "not_matched").length;
  if (evaluated.results.length !== 7 || matched !== 4 || notMatched !== 3 || evaluated.exceptions.length !== 4) {
    throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_RULE_RESULT_MISMATCH");
  }
  const resolutionCases = store.listResolutionCases(TENANT_ID, contextId).length;
  if (resolutionCases !== 0) throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_RESOLUTION_CASE_UNEXPECTED");
  return {
    evaluations: evaluated.results.length,
    matched,
    notMatched,
    exceptions: evaluated.exceptions.length,
    resolutionCases,
  };
}

function toSummary(report: OpenSupOSRuntimeVerificationReport): OpenSupOSRuntimeVerificationSummary {
  return {
    schemaVersion: report.schemaVersion,
    upstreamCommit: report.upstreamCommit,
    runtimeVerified: report.runtimeVerified,
    mqttConnected: report.mqttConnected,
    mqttSubscribed: report.mqttSubscribed,
    brokerProbeRoundTrip: report.brokerProbeRoundTrip,
    messagesPublished: report.messagesPublished,
    messagesIngested: report.messagesIngested,
    duplicateBatchStable: report.duplicateBatchStable,
    domain: report.domain,
    rules: report.rules,
    resolutionCases: report.resolutionCases,
    unsVisibility: report.unsVisibility,
    openApiGateway: report.openApiGateway,
    upstreamPatchRequired: report.upstreamPatchRequired,
    blocker: report.blocker,
  };
}

export function writeRuntimeVerificationReports(
  report: OpenSupOSRuntimeVerificationReport,
  paths: { raw?: string; summary?: string } = {},
) {
  const rawPath = resolve(paths.raw ?? RAW_REPORT_PATH);
  const summaryPath = resolve(paths.summary ?? SUMMARY_PATH);
  mkdirSync(dirname(rawPath), { recursive: true });
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(rawPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(toSummary(report), null, 2)}\n`, "utf8");
}

export async function runOpenSupOSRuntimeVerification(
  options: RuntimeVerificationOptions = {},
): Promise<RuntimeVerificationResult> {
  const env = options.env ?? process.env;
  if (env.OPEN_SUPOS_ENABLED !== "true") return { status: "disabled" };

  const runId = options.runId ?? randomUUID();
  const timeoutMs = options.timeoutMs ?? Number(env.OPEN_SUPOS_VERIFY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const now = options.now ?? (() => new Date());
  const transportFactory = options.transportFactory ?? defaultTransportFactory;
  const realRuntimeTransport = !options.transportFactory;
  const storeFactory = options.storeFactory ?? defaultStoreFactory;
  const { url, upstreamCommit } = requireEnabledEnv(env);
  assertDistinctClientIds(env, runId);
  const databasePath = freshDatabasePath(env, runId);
  const messages = buildSoMfg001UnsMessages();
  const contextId = mapUnsEnvelopeToDomainPlan(messages[0]!.envelope).context.id;
  const startedAt = now().toISOString();
  const receipts: RuntimeReceipt[] = [];
  const publishedAtByBatchAndMessageId = new Map<string, string>();
  let activeBatch: 1 | 2 = 1;
  let subscriber: UnsTransport | undefined;
  let publisher: UnsTransport | undefined;
  const handle = storeFactory(databasePath);

  const baseReport: OpenSupOSRuntimeVerificationReport = {
    schemaVersion: "open-supos-runtime-verification/v1",
    upstreamCommit,
    runtimeVerified: false,
    mqttConnected: false,
    mqttSubscribed: false,
    brokerProbeRoundTrip: false,
    messagesPublished: 0,
    messagesIngested: 0,
    duplicateBatchStable: false,
    domain: { sourceSystems: 0, entities: 0, references: 0, documents: 0, events: 0, evidence: 0 },
    rules: { evaluations: 0, matched: 0, notMatched: 0, exceptions: 0 },
    resolutionCases: 0,
    unsVisibility: "not_verified",
    openApiGateway: "not_verified",
    upstreamPatchRequired: env.OPEN_SUPOS_UPSTREAM_PATCH_REQUIRED === "true",
    blocker: null,
    runId,
    mqttEndpoint: redactMqttUrl(url),
    databaseFresh: true,
    receipts,
    startedAt,
    completedAt: startedAt,
  };

  try {
    await probeBroker({ env, runId, timeoutMs, transportFactory });
    baseReport.brokerProbeRoundTrip = true;

    const adapter = new OpenSupOSAdapter(handle.store);
    subscriber = transportFactory({
      role: "subscriber",
      url,
      username: env.OPEN_SUPOS_MQTT_USERNAME,
      password: env.OPEN_SUPOS_MQTT_PASSWORD,
      clientId: clientId(env, "subscriber", runId),
    });
    const inbound = await startConfiguredOpenSupOSInbound(adapter, {
      env: {
        ...env,
        OPEN_SUPOS_ENABLED: "true",
        OPEN_SUPOS_MQTT_CLIENT_ID: clientId(env, "subscriber", runId),
      },
      transportFactory: () => subscriber!,
      onIngest: (topic, _payload, result: OpenSupOSInboundResult) => {
        const envelope = messages.find((message) => message.envelope.messageId === result.messageId);
        if (!envelope) return;
        receipts.push({
          messageId: result.messageId,
          topic,
          batch: activeBatch,
          publishedAt: publishedAtByBatchAndMessageId.get(`${activeBatch}:${result.messageId}`) ?? "",
          observedAt: now().toISOString(),
          domainEventId: result.eventId,
          evidenceIds: result.evidenceIds,
          duplicated: result.duplicated,
        });
      },
    });
    if (inbound.status !== "started") throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_SUBSCRIBER_NOT_STARTED");
    baseReport.mqttConnected = true;
    baseReport.mqttSubscribed = true;

    publisher = transportFactory({
      role: "publisher",
      url,
      username: env.OPEN_SUPOS_MQTT_USERNAME,
      password: env.OPEN_SUPOS_MQTT_PASSWORD,
      clientId: clientId(env, "publisher", runId),
    });
    await publisher.connect();

    for (const message of messages) {
      publishedAtByBatchAndMessageId.set(`1:${message.envelope.messageId}`, now().toISOString());
      await publisher.publish(message.topic, JSON.stringify(message.envelope));
    }
    baseReport.messagesPublished = messages.length;
    await waitFor({
      timeoutMs,
      timeoutCode: "OPEN_SUPOS_RUNTIME_INGEST_TIMEOUT",
      read: () => messages.every((message) => receipts.some((receipt) => receipt.messageId === message.envelope.messageId && receipt.batch === 1)) ? true : undefined,
    });
    baseReport.messagesIngested = new Set(receipts.map((item) => item.messageId)).size;
    baseReport.domain = assertDomainState(handle.store.replayContext(TENANT_ID, contextId));

    activeBatch = 2;
    for (const message of messages) {
      publishedAtByBatchAndMessageId.set(`2:${message.envelope.messageId}`, now().toISOString());
      await publisher.publish(message.topic, JSON.stringify(message.envelope));
    }
    await waitFor({
      timeoutMs,
      timeoutCode: "OPEN_SUPOS_RUNTIME_DUPLICATE_TIMEOUT",
      read: () => messages.every((message) => receipts.filter((receipt) => receipt.messageId === message.envelope.messageId).length >= 2) ? true : undefined,
    });
    const duplicateReplay = handle.store.replayContext(TENANT_ID, contextId);
    const duplicateDomain = assertDomainState(duplicateReplay);
    if (JSON.stringify(duplicateDomain) !== JSON.stringify(baseReport.domain)) {
      throw new RuntimeVerificationError("OPEN_SUPOS_RUNTIME_DUPLICATE_COUNT_CHANGED");
    }
    baseReport.duplicateBatchStable = true;

    const ruleResult = runManufacturingRules(handle.store, contextId);
    baseReport.rules = {
      evaluations: ruleResult.evaluations,
      matched: ruleResult.matched,
      notMatched: ruleResult.notMatched,
      exceptions: ruleResult.exceptions,
    };
    baseReport.resolutionCases = ruleResult.resolutionCases;
    baseReport.completedAt = now().toISOString();
    if (!realRuntimeTransport) {
      baseReport.blocker = "INJECTED_TRANSPORT_NOT_REAL_RUNTIME";
      return { status: "simulated", report: baseReport, summary: toSummary(baseReport) };
    }
    baseReport.runtimeVerified = true;
    return { status: "passed", report: baseReport, summary: toSummary(baseReport) };
  } finally {
    await disconnectQuietly(publisher);
    await disconnectQuietly(subscriber);
    handle.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runOpenSupOSRuntimeVerification();
  if (result.status === "disabled") {
    console.log(JSON.stringify({ status: "disabled" }, null, 2));
  } else if (result.status === "passed") {
    writeRuntimeVerificationReports(result.report);
    console.log(JSON.stringify(result.summary, null, 2));
  } else {
    console.log(JSON.stringify({ status: "simulated", runtimeVerified: false }, null, 2));
  }
}
