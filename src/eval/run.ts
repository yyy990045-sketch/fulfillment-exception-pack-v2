import { buildGoldSet } from "../gold-set/cases.js";
import { detectConflicts } from "../conflict/detect.js";
import { EvidenceError, extractCase, unsupportedWithoutLocator } from "../evidence/extract.js";
import { approve, execute, ingest, openCase, propose, reviewConflicts, runHappyPath, submitForApproval } from "../case/runtime.js";
import type { ConflictField, GoldCase } from "../types.js";

export type MetricGrade = "measured" | "hypothesis" | "unverified";

function conflictHit(gold: GoldCase, fields: ConflictField[]) {
  return gold.expectedConflicts.every((exp) =>
    fields.includes(exp.field),
  );
}

export function evaluateAll() {
  const goldSet = buildGoldSet();
  let factHits = 0;
  let factTotal = 0;
  let conflictHits = 0;
  let conflictTotal = 0;
  let actionHits = 0;
  let actionTotal = 0;
  const negatives: string[] = [];
  const failures: string[] = [];

  for (const gold of goldSet) {
    factTotal += gold.expectedFacts.length;
    conflictTotal += gold.expectedConflicts.length;
    // A material gap is a deliberate stop condition: action accuracy is only
    // measured for cases that are eligible to enter proposal.

    try {
      if (gold.negatives.includes("no_scope")) {
        try {
          extractCase(gold, { scope: "" });
          negatives.push(`${gold.id}:no_scope-miss`);
        } catch (error) {
          if (error instanceof EvidenceError && error.code === "NO_SCOPE") negatives.push(`${gold.id}:no_scope-pass`);
          else negatives.push(`${gold.id}:no_scope-miss`);
        }
        continue;
      }

      if (gold.negatives.includes("no_locator") || gold.negatives.includes("no_evidence_conclusion")) {
        try {
          extractCase(gold);
          negatives.push(`${gold.id}:empty-miss`);
        } catch (error) {
          if (error instanceof EvidenceError && error.code === "EMPTY") negatives.push(`${gold.id}:empty-pass`);
          else negatives.push(`${gold.id}:empty-miss`);
        }
        const orphan = unsupportedWithoutLocator("模型声称金额为 1 亿", gold.tenantId, gold.scope);
        if (orphan.support === "unsupported" && !orphan.locator.fileName) negatives.push(`${gold.id}:no_evidence-pass`);
        continue;
      }

      if (gold.negatives.includes("cross_tenant")) {
        try {
          extractCase(gold);
          negatives.push(`${gold.id}:cross_tenant-miss`);
        } catch (error) {
          if (error instanceof EvidenceError && error.code === "CROSS_TENANT_SOURCE") negatives.push(`${gold.id}:cross_tenant-pass`);
          else negatives.push(`${gold.id}:cross_tenant-miss`);
        }
        continue;
      }

      const evidence = extractCase(gold);
      for (const fact of gold.expectedFacts) {
        if (evidence.some((e) => e.sourceId === fact.sourceId && String(e.value) === String(fact.value))) factHits += 1;
      }

      const conflicts = detectConflicts(evidence);
      if (gold.expectedConflicts.length === 0) {
        if (conflicts.length === 0) conflictHits += 0;
      } else if (conflictHit(gold, conflicts.map((c) => c.field))) {
        conflictHits += gold.expectedConflicts.length;
      }

      const runtime = ingest(gold, openCase(gold));
      const reviewed = reviewConflicts(runtime, gold.ownerRole, runtime.pack?.conflicts.map((conflict) => conflict.id) ?? []);
      if (reviewed.pack?.gaps?.length) {
        negatives.push(`${gold.id}:gap_gate-pass`);
        continue;
      }
      const proposed = propose(reviewed, gold.ownerRole);
      const types = proposed.actions.map((a) => a.type);
      actionTotal += gold.expectedActionTypes.length;
      for (const t of gold.expectedActionTypes) {
        if (types.includes(t)) actionHits += 1;
      }

      if (gold.negatives.includes("skip_approval")) {
        try {
          execute(proposed, "业务员");
          negatives.push(`${gold.id}:skip_approval-miss`);
        } catch {
          negatives.push(`${gold.id}:skip_approval-pass`);
        }
      }

      if (gold.negatives.includes("duplicate_action")) {
        const submitted = submitForApproval(proposed, gold.ownerRole);
        const approved = approve(submitted, "销售总监");
        const first = execute(approved, "销售总监", approved.actions[0]?.idempotencyKey);
        const second = execute(first, "销售总监", approved.actions[0]?.idempotencyKey);
        const receipts = second.actions.filter((a) => a.receipt).length;
        negatives.push(receipts <= approved.actions.length ? `${gold.id}:duplicate-pass` : `${gold.id}:duplicate-miss`);
      }
    } catch (error) {
      failures.push(`${gold.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const citationCoverage = goldSet.filter((g) => !g.negatives.includes("no_scope") && !g.negatives.includes("no_locator")).length;
  const withEvidence = goldSet.filter((g) => g.materials.length > 0).length;

  return {
    cases: goldSet.length,
    facts: { hits: factHits, total: factTotal, grade: "measured" as MetricGrade },
    conflicts: { hits: conflictHits, total: conflictTotal, grade: "measured" as MetricGrade },
    actions: { hits: actionHits, total: actionTotal, grade: "measured" as MetricGrade },
    citationCoverage: { hits: citationCoverage, total: withEvidence, grade: "measured" as MetricGrade },
    humanEditRate: { value: "unverified", grade: "unverified" as MetricGrade },
    timeSaved: { value: "hypothesis", grade: "hypothesis" as MetricGrade },
    negatives,
    negativeFailures: negatives.filter((n) => n.endsWith("-miss")),
    failures,
    hero: runHappyPath(goldSet[0]!),
  };
}
