import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildGoldSet } from "../src/gold-set/cases.js";
import { detectConflicts } from "../src/conflict/detect.js";
import { CsvParseError, EvidenceError, extractCase, parseCsv, unsupportedWithoutLocator } from "../src/evidence/extract.js";
import {
  actionMayExecute,
  approve,
  canTransition,
  execute,
  ingest,
  openCase,
  propose,
  reviewConflicts,
  runHappyPath,
  submitForApproval,
  verifyAndClose,
} from "../src/case/runtime.js";
import { permissions, resume, runGraph } from "../src/agents/graph.js";
import { buildContestSet } from "../src/gold-set/cases.js";
import { buildItOpsGoldSet } from "../src/gold-set/it-ops.js";
import { evaluateAll } from "../src/eval/run.js";
import { buildReport } from "../src/report/build.js";

const goldSet = buildGoldSet();
const hero = goldSet.find((c) => c.id === "FX-001")!;
const aligned = goldSet.find((c) => c.id === "FX-029")!;
const itAlert = goldSet.find((c) => c.id === "FX-030")!;

describe("Sprint 3 gold set", () => {
  it("has 30 synthetic cases and no real customer tokens", () => {
    expect(goldSet).toHaveLength(30);
    const blob = JSON.stringify(goldSet);
    expect(blob).not.toMatch(/orbbec|小熊|weinikan|SUPABASE|AMD_API/i);
    expect(goldSet.filter((c) => c.pack === "fulfillment")).toHaveLength(29);
    expect(itAlert?.pack).toBe("it-alert");
  });
});

describe("Sprint 4 contracts / state machine", () => {
  it("locks evidence pack schema version", () => {
    const schema = JSON.parse(readFileSync(new URL("../contracts/evidence-pack.v1.json", import.meta.url), "utf8"));
    expect(schema.properties.schemaVersion.const).toBe("evidence-pack-v1");
  });

  it("forbids illegal case jumps and execution before approval", () => {
    expect(canTransition("new", "closed")).toBe(false);
    expect(actionMayExecute("proposed")).toBe(false);
    expect(actionMayExecute("approved")).toBe(true);
  });
});

describe("Sprint 5-6 evidence and conflicts", () => {
  it("parses RFC4180 CSV without splitting quoted commas or newlines", () => {
    const parsed = parseCsv("\uFEFF订单号,问题描述,负责人\r\nSO-1,\"尺寸异常，客户说\n需要复核\",\"张\"\"工\"\r\n");
    expect(parsed.headers).toEqual(["订单号", "问题描述", "负责人"]);
    expect(parsed.rows).toEqual([["SO-1", "尺寸异常，客户说\n需要复核", "张\"工"]]);
  });

  it("fails closed on malformed or inconsistent CSV", () => {
    expect(() => parseCsv("订单号,数量\nSO-1,2,extra\n")).toThrow(CsvParseError);
    expect(() => parseCsv("订单号,数量\nSO-1,\"2\n")).toThrow(CsvParseError);
    const malformed = { ...hero, materials: [{ ...hero.materials[0]!, csv: "订单号,数量\nSO-1,not-a-number\n" }] };
    expect(() => extractCase(malformed)).toThrow(/INVALID_CSV/);
  });

  it("hero case extracts locators and both qty/amount conflicts", () => {
    const evidence = extractCase(hero);
    expect(evidence.every((e) => e.locator.fileName && (e.locator.row || e.locator.line))).toBe(true);
    const conflicts = detectConflicts(evidence);
    expect(conflicts.some((c) => c.field === "qty")).toBe(true);
    expect(conflicts.some((c) => c.field === "amount")).toBe(true);
    expect(conflicts.every((c) => c.resolution === "unresolved")).toBe(true);
  });

  it("fail-closed without scope and rejects cross-tenant sources", () => {
    expect(() => extractCase(hero, { scope: "" })).toThrow(EvidenceError);
    const foreign = goldSet.find((c) => c.id === "FX-016")!;
    try {
      extractCase(foreign);
      throw new Error("expected_cross_tenant_source");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceError);
      expect((error as EvidenceError).code).toBe("CROSS_TENANT_SOURCE");
    }
  });

  it("unsupported claims without locator cannot become facts", () => {
    const orphan = unsupportedWithoutLocator("金额 1 亿", hero.tenantId, hero.scope);
    expect(orphan.support).toBe("unsupported");
    expect(detectConflicts([orphan])).toHaveLength(0);
  });

  it("aligned case has no false conflicts", () => {
    expect(detectConflicts(extractCase(aligned))).toHaveLength(0);
  });

  it("extracts prefixed model fields without treating model numbers as quantities", () => {
    const caseWithPrefixedModel = goldSet.find((candidate) => candidate.id === "FX-023")!;
    const evidence = extractCase(caseWithPrefixedModel);
    const conflicts = detectConflicts(evidence);
    expect(evidence.some((item) => item.compareKey === "model" && item.value === "NX-240")).toBe(true);
    expect(conflicts.some((conflict) => {
      if (conflict.field !== "model") return false;
      const values = new Set([String(conflict.leftValue), String(conflict.rightValue)]);
      return values.has("NX-240") && values.has("NX-110");
    })).toBe(true);
    expect(conflicts.some((conflict) => conflict.field === "qty")).toBe(false);
  });

  it("keeps contextual sample quantities out of order quantity comparisons", () => {
    const caseWithPrefixedModel = goldSet.find((candidate) => candidate.id === "FX-023")!;
    const evidence = extractCase(caseWithPrefixedModel);
    const sampleQuantity = evidence.find((item) => item.sourceKind === "email" && item.compareKey === "sampleQty");
    expect(sampleQuantity?.value).toBe(2);
    expect(evidence.some((item) => item.sourceKind === "email" && item.compareKey === "qty")).toBe(false);
  });

  it("keeps source versions and complaint order IDs explicit", () => {
    const evidence = extractCase(hero);
    expect(evidence.every((item) => item.id.includes(item.sourceVersion))).toBe(true);
    expect(evidence.some((item) => item.field === "orderId" && item.sourceKind === "order")).toBe(true);
    const runtime = ingest(hero, openCase(hero));
    expect(runtime.pack?.gaps).toContain("complaint.orderId");
    expect(runtime.pack?.conflictIssues?.length).toBeLessThan(runtime.pack?.conflicts.length ?? 0);
  });
});

describe("Sprint 7-9 runtime / actions / agents", () => {
  it("blocks hero proposal while complaint order evidence is missing", () => {
    const paused = runHappyPath(hero);
    expect(paused.status).toBe("confirmed");
    expect(paused.pausedAfter).toBe("Review");
    expect(() => propose(paused, hero.ownerRole)).toThrow(/gaps_required/);
  });

  it("skips execute before approval and is idempotent after", () => {
    const noGap = goldSet.find((candidate) => candidate.id === "FX-002")!;
    const runtime = ingest(noGap, openCase(noGap));
    expect(() => propose(runtime, noGap.ownerRole)).toThrow(/review_required/);
    const reviewed = reviewConflicts(runtime, noGap.ownerRole, runtime.pack?.conflicts.map((conflict) => conflict.id) ?? []);
    const proposed = propose(reviewed, noGap.ownerRole);
    expect(() => execute(proposed, "销售总监")).toThrow(/approval_required/);
    const submitted = submitForApproval(proposed, noGap.ownerRole);
    const approved = approve(submitted, "销售总监", undefined, ["销售总监"]);
    const key = approved.actions[0]!.idempotencyKey;
    const first = execute(approved, "销售总监", key);
    const second = execute(first, "销售总监", key);
    expect(first.actions.filter((a) => a.receipt).map((a) => a.receipt)).toEqual(
      second.actions.filter((a) => a.receipt).map((a) => a.receipt),
    );
  });

  it("requires every conflict to be reviewed before proposing", () => {
    const runtime = ingest(hero, openCase(hero));
    const first = runtime.pack?.conflicts[0]?.id;
    expect(first).toBeTruthy();
    const partiallyReviewed = reviewConflicts(runtime, hero.ownerRole, [first!]);
    expect(partiallyReviewed.status).toBe("new");
    expect(() => propose(partiallyReviewed, hero.ownerRole)).toThrow(/review_required/);
    const reviewed = reviewConflicts(partiallyReviewed, hero.ownerRole, runtime.pack?.conflicts.map((conflict) => conflict.id) ?? []);
    expect(reviewed.status).toBe("confirmed");
    expect(() => propose(reviewed, hero.ownerRole)).toThrow(/gaps_required/);
  });

  it("rejects re-proposal and closing before an action receipt", () => {
    const noGap = goldSet.find((candidate) => candidate.id === "FX-002")!;
    let runtime = ingest(noGap, openCase(noGap));
    runtime = reviewConflicts(runtime, noGap.ownerRole, runtime.pack?.conflicts.map((conflict) => conflict.id) ?? []);
    runtime = propose(runtime, noGap.ownerRole);
    runtime = submitForApproval(runtime, noGap.ownerRole);
    runtime = approve(runtime, "销售总监", undefined, ["销售总监"]);
    expect(() => propose(runtime, noGap.ownerRole)).toThrow(/proposal_not_allowed/);
    expect(() => verifyAndClose(runtime, "销售总监")).toThrow(/receipt_required/);
  });

  it("persists conflict decision, selected evidence, and rationale", () => {
    const runtime = ingest(hero, openCase(hero));
    const conflict = runtime.pack!.conflicts[0]!;
    const reviewed = reviewConflicts(runtime, hero.ownerRole, [{
      conflictId: conflict.id,
      decision: "accept_left",
      selectedEvidenceId: conflict.leftEvidenceId,
      rationale: "订单材料是当前履约口径",
    }]);
    expect(reviewed.conflictReviews?.[0]).toMatchObject({ conflictId: conflict.id, decision: "accept_left", selectedEvidenceId: conflict.leftEvidenceId, rationale: "订单材料是当前履约口径", actor: hero.ownerRole });
    expect(reviewed.pack?.conflicts[0]?.resolution).toBe("resolved");
    expect(reviewed.pack?.conflictIssues?.find((issue) => issue.id === conflict.issueId)?.resolution).toBe("resolved");
    expect(() => reviewConflicts(runtime, hero.ownerRole, [{ conflictId: conflict.id, decision: "accept_left", selectedEvidenceId: conflict.leftEvidenceId, rationale: "" }])).toThrow(/review_rationale_required/);
  });

  it("pauses and resumes from the paused node without re-running Intake", () => {
    const paused = runGraph(hero, { pauseAfter: "Evidence" });
    expect(paused.runtime.paused).toBe(true);
    expect(paused.log).toEqual(["Intake", "Evidence"]);
    const resumed = resume(hero, paused.runtime);
    expect(resumed.runtime.status).toBe("confirmed");
    expect(resumed.log.filter((role) => role === "Intake")).toHaveLength(1);
    expect(resumed.log.slice(0, 2)).toEqual(["Intake", "Evidence"]);
    expect(resumed.log).toContain("Review");
    expect(permissions("Evidence").canWriteTongyue).toBe(false);
  });
});

describe("Sprint 11 eval / Sprint 13 second pack", () => {
  it("eval report marks measured vs hypothesis and negatives pass", () => {
    const report = evaluateAll();
    expect(report.cases).toBe(30);
    expect(report.timeSaved.grade).toBe("hypothesis");
    expect(report.humanEditRate.grade).toBe("unverified");
    expect(report.facts.grade).toBe("measured");
    expect(report.negativeFailures).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it("IT alert pack reuses Case/Action without renaming core statuses", () => {
    const closed = runHappyPath(itAlert, "工程师");
    expect(closed.status).toBe("closed");
    expect(closed.actions[0]?.type).toBe("create_task");
    expect(canTransition("approved", "executed")).toBe(true);
  });

  it("ships IT-001 to IT-010 as a second pack alongside the 30 FX cases", () => {
    expect(buildGoldSet()).toHaveLength(30);
    expect(buildItOpsGoldSet()).toHaveLength(10);
    expect(buildContestSet().some((item) => item.id === "IT-010")).toBe(true);
    expect(runHappyPath(buildItOpsGoldSet()[0]!, "工程师").status).toBe("closed");
  });
});

describe("industry report output", () => {
  it("renders a structured report whose conflicts retain source citations", () => {
    const noGap = goldSet.find((candidate) => candidate.id === "FX-002")!;
    const runtime = runHappyPath(noGap);
    const report = buildReport(noGap, runtime);
    expect(report.reportVersion).toBe("fulfillment-report-v1");
    expect(report.facts.length).toBeGreaterThan(0);
    expect(report.conflicts.length).toBeGreaterThan(0);
    expect(report.conflicts.every((conflict) => conflict.citationIds.length === 2)).toBe(true);
    expect(report.conclusionCitationIds.length).toBeGreaterThan(0);
    expect(report.actions.every((action) => action.receipt || action.status === "verified")).toBe(true);
  });
});
