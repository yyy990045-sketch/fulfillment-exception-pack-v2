import { writeFileSync } from "node:fs";
import { buildGoldSet } from "../gold-set/cases.js";
import { buildConflictIssues, detectConflicts, gapsFrom } from "../conflict/detect.js";
import { extractCase } from "../evidence/extract.js";

const packs: Record<string, unknown> = {};
for (const gold of buildGoldSet()) {
  try {
    const evidence = extractCase(gold);
    const conflicts = detectConflicts(evidence);
    packs[gold.id] = {
      schemaVersion: "evidence-pack-v1",
      tenantId: gold.tenantId,
      caseId: gold.id,
      evidence,
      structuredFields: Object.fromEntries(evidence.map((item) => [`${item.sourceId}:${item.sourceVersion}:${item.field}`, item.value])),
      conflicts,
      conflictIssues: buildConflictIssues(conflicts),
      gaps: gapsFrom(evidence),
      traceId: `tr-${gold.id}`,
    };
  } catch (error) {
    packs[gold.id] = { error: error instanceof Error ? error.message : String(error) };
  }
}
writeFileSync("/Users/xieweikai/Projects/qa-system/src/lib/fulfillment-case/packs.json", JSON.stringify(packs));
console.log(`dumped ${Object.keys(packs).length}`);
