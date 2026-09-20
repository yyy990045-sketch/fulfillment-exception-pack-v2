/**
 * 把当前租户的运营分析口径导出为 Superset 可用的分析投影 SQL。
 *
 * 复用后端同一套 buildOperationalAnalytics（不另写统计逻辑），因此 Superset 里看到的
 * 数字与 /api/v2/analytics/operational 完全同源。单租户 pilot：每次只导出配置中绑定的
 * 那一个租户，投影库不混入其它租户数据。
 *
 * 用法：npm run superset:export [输出路径]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOperationalAnalytics } from "../src/analytics/index.js";
import { openV2SqliteStore } from "../src/domain/v2/runtime-store.js";

/** 与 frontend/src/lib/presentation.ts 的阶段标签保持一致（用于投影里的可读标签） */
const RESOLUTION_STAGES: Array<{ key: string; label: string }> = [
  { key: "no_case", label: "未进入治理" },
  { key: "triaged", label: "待复核" },
  { key: "confirmed", label: "已确认" },
  { key: "proposed_draft", label: "方案草案" },
  { key: "pending_approval", label: "待审批" },
  { key: "approved", label: "已批准" },
  { key: "executed", label: "已执行" },
  { key: "closed", label: "已结案" },
  { key: "rejected", label: "已终止" },
];

function sqlText(value: unknown) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function sqlInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Math.trunc(parsed)) : "0";
}

function sqlRate(value: unknown) {
  if (value === null || value === undefined) return "null";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "null";
}

const tenantId = (process.env.SUPERSET_PRODUCT_TENANT_ID ?? "demo-manufacturing").trim();
// 默认写到 .preview/（已 gitignore），避免把生成物带进仓库
const outputPath = resolve(process.argv[2] ?? ".preview/superset/projection.sql");

const store = openV2SqliteStore();
const view = buildOperationalAnalytics(store, tenantId, {});

const lines: string[] = [];
lines.push("-- 由 scripts/export-superset-projection.ts 生成，请勿手工编辑");
lines.push(`-- tenant_id: ${tenantId}`);
lines.push(`-- generated_at: ${new Date().toISOString()}`);
lines.push("BEGIN;");
lines.push("TRUNCATE analytics.fact_exception_type, analytics.fact_resolution_stage, analytics.fact_rule_performance, analytics.fact_source_system;");

for (const item of view.exceptionBreakdown) {
  lines.push(
    "INSERT INTO analytics.fact_exception_type (tenant_id, exception_code, exception_label, exception_count) VALUES ("
    + `${sqlText(tenantId)}, ${sqlText(item.code)}, ${sqlText(item.label)}, ${sqlInt(item.count)});`,
  );
}

RESOLUTION_STAGES.forEach((stage, index) => {
  const count = Number((view.resolutionFunnel as Record<string, number>)[stage.key] ?? 0);
  lines.push(
    "INSERT INTO analytics.fact_resolution_stage (tenant_id, stage, stage_label, stage_order, exception_count) VALUES ("
    + `${sqlText(tenantId)}, ${sqlText(stage.key)}, ${sqlText(stage.label)}, ${index + 1}, ${sqlInt(count)});`,
  );
});

for (const rule of view.rulePerformance) {
  lines.push(
    "INSERT INTO analytics.fact_rule_performance (tenant_id, rule_code, rule_label, matched, not_matched, evaluations, trigger_rate) VALUES ("
    + `${sqlText(tenantId)}, ${sqlText(rule.code)}, ${sqlText(rule.label)}, ${sqlInt(rule.matched)}, ${sqlInt(rule.notMatched)}, ${sqlInt(rule.evaluations)}, ${sqlRate(rule.triggerRate)});`,
  );
}

for (const source of view.sourceSystemInvolvement) {
  lines.push(
    "INSERT INTO analytics.fact_source_system (tenant_id, source_system_id, source_system_name, system_type, involved_exception_count) VALUES ("
    + `${sqlText(tenantId)}, ${sqlText(source.sourceSystemId)}, ${sqlText(source.name)}, ${sqlText(source.systemType)}, ${sqlInt(source.involvedExceptionCount)});`,
  );
}

lines.push("COMMIT;");
writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  output: outputPath,
  tenantId,
  exceptionTypes: view.exceptionBreakdown.length,
  resolutionStages: RESOLUTION_STAGES.length,
  rules: view.rulePerformance.length,
  sourceSystems: view.sourceSystemInvolvement.length,
  detectedExceptions: view.summary.detectedExceptionCount,
}, null, 2));
