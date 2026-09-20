import { describe, expect, it } from "vitest";
import {
  buildExceptionOrderCase,
  buildNormalOrderCase,
  buildOpenSupOSAbCases,
} from "../src/integrations/open-supos/ab-cases.js";
import { runOpenSupOSAbContractVerification } from "../src/integrations/open-supos/contract-verify.js";
import {
  OPEN_SUPOS_RECORD_TYPE,
  OpenSuposInboundConnector,
  OpenSupOSUnsQueue,
  openSupOSCheckpointCursor,
} from "../src/integrations/open-supos/connector.js";

describe("open supOS A/B contract", () => {
  it("keeps the two cases structurally identical and only differs in the mismatch", () => {
    const normal = buildNormalOrderCase();
    const exception = buildExceptionOrderCase();
    expect(buildOpenSupOSAbCases().map((item) => item.caseId)).toEqual(["normal-order", "exception-order"]);
    expect(normal.messages).toHaveLength(11);
    expect(exception.messages).toHaveLength(11);
    // 结构完全一致：同样的 topic 形状、同样的 messageId 后缀顺序
    expect(normal.messages.map((item) => item.envelope.entity.entityType))
      .toEqual(exception.messages.map((item) => item.envelope.entity.entityType));
    expect(normal.expectation).toMatchObject({ evaluations: 7, matchedExceptionRules: 0, exceptions: 0 });
    expect(exception.expectation).toMatchObject({
      evaluations: 7,
      matchedExceptionRules: 1,
      exceptions: 1,
      exceptionCodes: ["ORDER_PRODUCTION_COMPLETION_SHORTFALL"],
    });
  });

  it("Case A creates no exception while Case B creates exactly the expected one", async () => {
    const report = await runOpenSupOSAbContractVerification();
    expect(report.failures).toEqual([]);
    expect(report.status).toBe("pass");
    expect(report.verdict).toBe("LOCAL_CONTRACT_VERIFIED");

    const normal = report.cases.find((item) => item.caseId === "normal-order")!;
    expect(normal.evaluations).toBe(7);
    expect(normal.matchedExceptionRules).toBe(0);
    expect(normal.exceptions).toBe(0);
    expect(normal.exceptionCodes).toEqual([]);
    expect(normal.recordsRead).toBe(11);
    expect(normal.ledgerRecords).toBe(11);
    expect(normal.provenance.locatorNamespace).toBe("fulfillment/demo-manufacturing");
    expect(normal.provenance.locatorTopicSample).toContain("SO-AB-N-001");
    expect(normal.provenance.ledgerEvidenceRefs).toBeGreaterThan(0);
    expect(normal.provenance.ledgerCanonicalRefs).toBeGreaterThan(0);

    const exception = report.cases.find((item) => item.caseId === "exception-order")!;
    expect(exception.evaluations).toBe(7);
    expect(exception.matchedExceptionRules).toBe(1);
    expect(exception.exceptions).toBe(1);
    expect(exception.exceptionCodes).toEqual(["ORDER_PRODUCTION_COMPLETION_SHORTFALL"]);
    expect(exception.ledgerRecords).toBe(11);
  });

  it("replay of the exception case is idempotent and the checkpoint does not re-read", async () => {
    const report = await runOpenSupOSAbContractVerification();
    expect(report.replay).toMatchObject({
      caseId: "exception-order",
      duplicateInput: 11,
      duplicateLedgerRecords: 0,
      newEvents: 0,
      newExceptions: 0,
      checkpointRecordsRead: 0,
      passed: true,
      failures: [],
    });
    expect(report.replay.exceptionsAfter).toBe(report.replay.exceptionsBefore);
    expect(report.replay.exceptionsBefore).toBe(1);
  });

  it("checkpoint cursor is content addressed (occurredAt + messageId)", () => {
    const message = buildNormalOrderCase().messages[0]!;
    expect(openSupOSCheckpointCursor(message.envelope))
      .toBe(`${message.envelope.event.occurredAt}#${message.envelope.messageId}`);
  });

  it("queue pages deterministically and never returns the same message twice", () => {
    const queue = new OpenSupOSUnsQueue();
    const messages = buildExceptionOrderCase().messages;
    for (const message of messages) queue.push({ topic: message.topic, payload: JSON.stringify(message.envelope), envelope: message.envelope });
    // 同一条消息重复 push 不产生第二份
    for (const message of messages) queue.push({ topic: message.topic, payload: JSON.stringify(message.envelope), envelope: message.envelope });
    expect(queue.pending).toBe(11);

    const first = queue.readAfter(null, 4);
    expect(first.records).toHaveLength(4);
    expect(first.hasMore).toBe(true);
    const second = queue.readAfter(first.nextCursor, 20);
    expect(second.records).toHaveLength(7);
    expect(second.hasMore).toBe(false);
    const ids = [...first.records, ...second.records].map((item) => item.externalRecordId);
    expect(new Set(ids).size).toBe(11);
    expect(first.records[0]!.recordType).toBe(OPEN_SUPOS_RECORD_TYPE);
  });

  it("connector manifest stays on the shared core API version", () => {
    const connector = new OpenSuposInboundConnector(new OpenSupOSUnsQueue());
    expect(connector.manifest.direction).toBe("inbound");
    expect(connector.manifest.compatibility.coreApiVersion).toBe("1");
    expect(connector.validateConfig({})).toEqual({ topicPrefix: "fulfillment" });
  });
});
