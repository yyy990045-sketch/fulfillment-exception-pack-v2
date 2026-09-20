/**
 * open supOS A/B 契约验证（本地，无真实运行时）。
 *
 * 两个 case 都走**同一条入口**：
 *   open supOS payload → OpenSuposInboundConnector → SourceRecordEnvelope →
 *   runInboundSync（Source Ledger / cursor / 重放 / 幂等）→ Business Entity/Event/Evidence →
 *   Rule Evaluation → Exception
 *
 * 这个 runner 给出的是 `LOCAL_CONTRACT_VERIFIED`，**不能**升级任何 live truth flag：
 * 它使用的是缓冲队列（等价于 injected transport），没有连接真实 open supOS / EMQX / UNS。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MANUFACTURING_RULE_DEFINITIONS,
  MANUFACTURING_RULE_VERSIONS,
  V2SqliteStore,
  evaluateContextRules,
  type SqliteDatabaseLike,
} from "../../domain/v2/index.js";
import { installConnector, runInboundSync } from "../../connectors/index.js";
import { bindPackContext, manufacturingFulfillmentPack, registerBuiltInSolutionPacks } from "../../solution-packs/index.js";
import { buildOpenSupOSAbCases, OPEN_SUPOS_AB_TENANT, type OpenSupOSAbCase } from "./ab-cases.js";
import {
  OPEN_SUPOS_INBOUND_MANIFEST,
  OPEN_SUPOS_MAPPING_ID,
  OPEN_SUPOS_MAPPING_VERSION,
  OPEN_SUPOS_RECORD_TYPE,
  OpenSuposInboundConnector,
  OpenSuposSourceAdapter,
  OpenSupOSUnsQueue,
} from "./connector.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };

const INSTALLATION_ID = "open-supos-uns-installation";
const PAGE_SIZE = 50;

export type OpenSupOSAbCaseEvidence = {
  caseId: string;
  label: string;
  contextId: string;
  published: number;
  ingested: number;
  recordsRead: number;
  recordsCommitted: number;
  recordsDuplicate: number;
  ledgerRecords: number;
  events: number;
  evidenceRows: number;
  evaluations: number;
  matchedExceptionRules: number;
  notMatchedRules: number;
  exceptions: number;
  exceptionCodes: string[];
  matchedRuleCodes: string[];
  provenance: {
    sourceSystems: string[];
    locatorNamespace: string;
    locatorTopicSample: string;
    ledgerEvidenceRefs: number;
    ledgerCanonicalRefs: number;
  };
  expectation: OpenSupOSAbCase["expectation"];
  passed: boolean;
  failures: string[];
};

export type OpenSupOSAbReplayEvidence = {
  caseId: string;
  duplicateInput: number;
  duplicateLedgerRecords: number;
  newEvents: number;
  newExceptions: number;
  exceptionsBefore: number;
  exceptionsAfter: number;
  checkpointRecordsRead: number;
  passed: boolean;
  failures: string[];
};

export type OpenSupOSAbContractReport = {
  schemaVersion: "open-supos-ab-contract/v1";
  verdict: "LOCAL_CONTRACT_VERIFIED" | "FAILED";
  status: "pass" | "fail";
  /** A/B 两个 case 共用的入口（证明它们不是两条不同实现） */
  entrypoint: {
    connectorId: string;
    mappingId: string;
    mappingVersion: string;
    installationId: string;
    recordType: string;
  };
  cases: OpenSupOSAbCaseEvidence[];
  replay: OpenSupOSAbReplayEvidence;
  failures: string[];
  generatedAt: string;
};

export type OpenSupOSAbContractOptions = {
  cases?: OpenSupOSAbCase[];
  now?: () => Date;
  recordLedger?: boolean;
};

function openScratchStore() {
  const directory = mkdtempSync(join(tmpdir(), "fep-open-supos-ab-"));
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("AB_CONTRACT_REQUIRES_NODE_22_5_OR_NEWER");
  const database = new builtin.DatabaseSync(join(directory, "ab.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return {
    store: new V2SqliteStore(database),
    close: () => {
      database.close?.();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function provision(store: V2SqliteStore) {
  registerBuiltInSolutionPacks();
  manufacturingFulfillmentPack.install(store, OPEN_SUPOS_AB_TENANT, "ab-contract", { ruleProfile: "manufacturing" });
  for (const definition of MANUFACTURING_RULE_DEFINITIONS) store.saveRuleDefinition(definition);
  for (const version of MANUFACTURING_RULE_VERSIONS) {
    store.saveRuleVersion(version);
    store.retireRuleVersionsExcept(version.tenantId, version.ruleId, version.id);
  }
}

function ensureContext(store: V2SqliteStore, context: ReturnType<OpenSuposSourceAdapter["contextFor"]>) {
  const existing = store.getContext(context.tenantId, context.id);
  if (!existing) store.saveContext(context);
  bindPackContext(store, manufacturingFulfillmentPack, context.tenantId, context.id, "ab-contract");
  return context.id;
}

function saveMapping(store: V2SqliteStore) {
  return store.saveConnectorMappingVersion({
    tenantId: OPEN_SUPOS_AB_TENANT,
    connectorId: OPEN_SUPOS_INBOUND_MANIFEST.id,
    mappingId: OPEN_SUPOS_MAPPING_ID,
    version: OPEN_SUPOS_MAPPING_VERSION,
    effectiveAt: "2026-09-01T00:00:00.000Z",
    definitionHash: createHash("sha256").update(`${OPEN_SUPOS_MAPPING_ID}:${OPEN_SUPOS_MAPPING_VERSION}`).digest("hex"),
    description: "open supOS UNS envelope → domain plan",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

/**
 * 一条 case 的完整流程（首次摄入 → 重放 → checkpoint），contract 与 live 共用同一份断言。
 *
 * 差别只在消息怎么进队列：contract 用预置缓冲队列（等价 injected transport），
 * live 用真实 MQTT 订阅者把消息灌进同一个队列，随后都交给 `runInboundSync`。
 */
export async function verifyOpenSupOSCaseFlow(input: {
  testCase: OpenSupOSAbCase;
  store: V2SqliteStore;
  adapter: OpenSuposSourceAdapter;
  queueFor: (stream: "initial" | "replay") => Promise<OpenSupOSUnsQueue>;
  now: () => Date;
}): Promise<{ evidence: OpenSupOSAbCaseEvidence; replay: OpenSupOSAbReplayEvidence }> {
  const { testCase, store, adapter, now } = input;
  {
    provision(store);
    const connector = new OpenSuposInboundConnector(await input.queueFor("initial"));
    const contexts = new Set<string>();
    for (const message of testCase.messages) {
      contexts.add(ensureContext(store, adapter.contextForEnvelope(message.envelope)));
    }
    const contextId = [...contexts][0]!;
    if (contexts.size !== 1) throw new Error(`AB_CASE_CONTEXT_NOT_UNIQUE:${testCase.caseId}`);
    installConnector(store, connector, {
      tenantId: OPEN_SUPOS_AB_TENANT,
      installationId: INSTALLATION_ID,
      config: { topicPrefix: "fulfillment" },
      actor: "ab-contract",
    });
    saveMapping(store);

    let evaluations = 0;
    let matched = 0;
    let notMatched = 0;
    const sync = await runInboundSync(store, connector, {
      tenantId: OPEN_SUPOS_AB_TENANT,
      connectorInstallationId: INSTALLATION_ID,
      recordType: OPEN_SUPOS_RECORD_TYPE,
      mappingId: OPEN_SUPOS_MAPPING_ID,
      mappingVersion: OPEN_SUPOS_MAPPING_VERSION,
      adapter,
      cursor: null,
      pageSize: PAGE_SIZE,
      now,
      afterPageCommit: ({ contextIds }) => {
        for (const id of contextIds) {
          const evaluated = evaluateContextRules(store, OPEN_SUPOS_AB_TENANT, id);
          if (!evaluated) continue;
          evaluations += evaluated.results.length;
          matched += evaluated.results.filter((item) => item.evaluation.status === "matched").length;
          notMatched += evaluated.results.filter((item) => item.evaluation.status === "not_matched").length;
        }
      },
    });
    const replayContext = store.replayContext(OPEN_SUPOS_AB_TENANT, contextId);
    const exceptionsAfterFirstRun = store.listExceptions(OPEN_SUPOS_AB_TENANT, contextId);
    const ledgerRecords = store.listConnectorSourceRecords(OPEN_SUPOS_AB_TENANT, INSTALLATION_ID, OPEN_SUPOS_RECORD_TYPE);
    const ledgerSample = ledgerRecords[0];
    const ledgerLocator = ledgerSample?.locator ?? {};
    const evidence: OpenSupOSAbCaseEvidence = {
      caseId: testCase.caseId,
      label: testCase.label,
      contextId,
      published: testCase.messages.length,
      ingested: sync.run.recordsAccepted,
      recordsRead: sync.run.recordsRead,
      recordsCommitted: sync.run.recordsCommitted,
      recordsDuplicate: sync.run.recordsDuplicate,
      ledgerRecords: store.listConnectorSourceRecords(OPEN_SUPOS_AB_TENANT, INSTALLATION_ID, OPEN_SUPOS_RECORD_TYPE).length,
      events: replayContext.events.length,
      evidenceRows: replayContext.evidence.length,
      evaluations,
      matchedExceptionRules: matched,
      notMatchedRules: notMatched,
      exceptions: exceptionsAfterFirstRun.length,
      exceptionCodes: exceptionsAfterFirstRun.map((item) => item.code).sort(),
      matchedRuleCodes: [...new Set(exceptionsAfterFirstRun.map((item) => item.ruleId))].sort(),
      provenance: {
        sourceSystems: [...new Set(replayContext.evidence.map((item) => item.sourceSystemId))].sort(),
        locatorNamespace: String(ledgerLocator.namespace ?? ""),
        locatorTopicSample: String(ledgerLocator.topic ?? ""),
        ledgerEvidenceRefs: ledgerSample?.evidenceRefs.length ?? 0,
        ledgerCanonicalRefs: ledgerSample?.canonicalRefs.length ?? 0,
      },
      expectation: testCase.expectation,
      passed: false,
      failures: [],
    };

    // Replay：把同样的消息按「broker 重放」重新投递（cursor=null），必须完全幂等
    const ledgerBefore = evidence.ledgerRecords;
    const eventsBefore = evidence.events;
    const exceptionsBefore = evidence.exceptions;
    const replayQueue = await input.queueFor("replay");
    const replayConnector = new OpenSuposInboundConnector(replayQueue);
    const replaySync = await runInboundSync(store, replayConnector, {
      tenantId: OPEN_SUPOS_AB_TENANT,
      connectorInstallationId: INSTALLATION_ID,
      recordType: OPEN_SUPOS_RECORD_TYPE,
      mappingId: OPEN_SUPOS_MAPPING_ID,
      mappingVersion: OPEN_SUPOS_MAPPING_VERSION,
      adapter,
      cursor: null,
      pageSize: PAGE_SIZE,
      now,
      afterPageCommit: ({ contextIds }) => {
        for (const id of contextIds) evaluateContextRules(store, OPEN_SUPOS_AB_TENANT, id);
      },
    });
    const ledgerAfterReplay = store.listConnectorSourceRecords(OPEN_SUPOS_AB_TENANT, INSTALLATION_ID, OPEN_SUPOS_RECORD_TYPE).length;
    const replayContextAfter = store.replayContext(OPEN_SUPOS_AB_TENANT, contextId);
    const exceptionsAfterReplay = store.listExceptions(OPEN_SUPOS_AB_TENANT, contextId);

    // checkpoint：沿用已提交 cursor 再跑一次，不应重复读取
    const checkpointSync = await runInboundSync(store, replayConnector, {
      tenantId: OPEN_SUPOS_AB_TENANT,
      connectorInstallationId: INSTALLATION_ID,
      recordType: OPEN_SUPOS_RECORD_TYPE,
      mappingId: OPEN_SUPOS_MAPPING_ID,
      mappingVersion: OPEN_SUPOS_MAPPING_VERSION,
      adapter,
      pageSize: PAGE_SIZE,
      now,
    });

    const replay: OpenSupOSAbReplayEvidence = {
      caseId: testCase.caseId,
      duplicateInput: replaySync.run.recordsRead,
      duplicateLedgerRecords: ledgerAfterReplay - ledgerBefore,
      newEvents: replayContextAfter.events.length - eventsBefore,
      newExceptions: exceptionsAfterReplay.length - exceptionsBefore,
      exceptionsBefore,
      exceptionsAfter: exceptionsAfterReplay.length,
      checkpointRecordsRead: checkpointSync.run.recordsRead,
      passed: false,
      failures: [],
    };

    const failures: string[] = [];
    if (evidence.recordsRead !== testCase.messages.length) failures.push(`recordsRead=${evidence.recordsRead}`);
    if (evidence.ingested !== testCase.messages.length) failures.push(`ingested=${evidence.ingested}`);
    if (evidence.ledgerRecords !== testCase.messages.length) failures.push(`ledgerRecords=${evidence.ledgerRecords}`);
    if (evidence.evaluations !== testCase.expectation.evaluations) failures.push(`evaluations=${evidence.evaluations}`);
    if (evidence.exceptions !== testCase.expectation.exceptions) failures.push(`exceptions=${evidence.exceptions}`);
    if (JSON.stringify(evidence.exceptionCodes) !== JSON.stringify([...testCase.expectation.exceptionCodes].sort())) {
      failures.push(`exceptionCodes=${evidence.exceptionCodes.join(",")}`);
    }
    if (!evidence.provenance.locatorNamespace || !evidence.provenance.locatorTopicSample) failures.push("provenance_locator_missing");
    if (evidence.provenance.ledgerEvidenceRefs === 0) failures.push("ledger_evidence_refs_missing");
    if (evidence.provenance.ledgerCanonicalRefs === 0) failures.push("ledger_canonical_refs_missing");
    evidence.failures = failures;
    evidence.passed = failures.length === 0;

    const replayFailures: string[] = [];
    if (replay.duplicateInput !== testCase.messages.length) replayFailures.push(`duplicateInput=${replay.duplicateInput}`);
    if (replay.duplicateLedgerRecords !== 0) replayFailures.push(`newLedgerRecords=${replay.duplicateLedgerRecords}`);
    if (replay.newEvents !== 0) replayFailures.push(`newEvents=${replay.newEvents}`);
    if (replay.newExceptions !== 0) replayFailures.push(`newExceptions=${replay.newExceptions}`);
    if (replay.exceptionsAfter !== replay.exceptionsBefore) replayFailures.push(`exceptionTotalChanged=${replay.exceptionsAfter}`);
    if (replay.checkpointRecordsRead !== 0) replayFailures.push(`checkpointRecordsRead=${replay.checkpointRecordsRead}`);
    replay.failures = replayFailures;
    replay.passed = replayFailures.length === 0;

    return { evidence, replay };
  }
}

async function runCase(testCase: OpenSupOSAbCase, now: () => Date) {
  const handle = openScratchStore();
  try {
    const adapter = new OpenSuposSourceAdapter(handle.store);
    return await verifyOpenSupOSCaseFlow({
      testCase,
      store: handle.store,
      adapter,
      now,
      queueFor: async () => {
        const queue = new OpenSupOSUnsQueue();
        for (const message of testCase.messages) {
          if (!queue.push({ topic: message.topic, payload: JSON.stringify(message.envelope), envelope: message.envelope })) {
            throw new Error(`AB_CASE_DUPLICATE_MESSAGE:${testCase.caseId}:${message.envelope.messageId}`);
          }
        }
        return queue;
      },
    });
  } finally {
    handle.close();
  }
}

export async function runOpenSupOSAbContractVerification(
  options: OpenSupOSAbContractOptions = {},
): Promise<OpenSupOSAbContractReport> {
  const now = options.now ?? (() => new Date());
  const cases = options.cases ?? buildOpenSupOSAbCases();
  const caseEvidence: OpenSupOSAbCaseEvidence[] = [];
  const replayEvidence: OpenSupOSAbReplayEvidence[] = [];
  const failures: string[] = [];
  for (const testCase of cases) {
    const result = await runCase(testCase, now);
    caseEvidence.push(result.evidence);
    replayEvidence.push(result.replay);
    for (const failure of result.evidence.failures) failures.push(`${testCase.caseId}:${failure}`);
    for (const failure of result.replay.failures) failures.push(`${testCase.caseId}:replay:${failure}`);
  }
  // replay 证据取异常用例（Case B），其余用例的 replay 结果同样保留在 cases 里
  const primary = replayEvidence.find((item) => item.caseId === "exception-order") ?? replayEvidence[0]!;
  return {
    schemaVersion: "open-supos-ab-contract/v1",
    verdict: failures.length === 0 ? "LOCAL_CONTRACT_VERIFIED" : "FAILED",
    status: failures.length === 0 ? "pass" : "fail",
    entrypoint: {
      connectorId: OPEN_SUPOS_INBOUND_MANIFEST.id,
      mappingId: OPEN_SUPOS_MAPPING_ID,
      mappingVersion: OPEN_SUPOS_MAPPING_VERSION,
      installationId: INSTALLATION_ID,
      recordType: OPEN_SUPOS_RECORD_TYPE,
    },
    cases: caseEvidence,
    replay: primary,
    failures,
    generatedAt: now().toISOString(),
  };
}
