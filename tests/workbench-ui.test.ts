import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../src/workbench/index.html", import.meta.url), "utf8");

describe("workbench UI contract (white-box)", () => {
  it("starts with a plain-language information hierarchy", () => {
    expect(html).toContain("履约异常处理台");
    expect(html).toContain("一眼结论");
    expect(html).toContain("异常概览");
    expect(html).toContain("核对证据");
    expect(html).toContain("处理结果");
    expect(html).toContain("下一步：核对信息差异");
    expect(html).toContain("下一步：拟定处理方案");
    expect(html).toContain("差异已全部核对，现在形成处理方案。");
    expect(html).toContain("开始核对 ${conflicts} 处差异");
    expect(html).toContain("有 ${conflicts} 处信息差异待核对");
    expect(html).toContain("待核对差异");
    expect(html).toContain("材料状态");
    expect(html).toContain("已齐全");
    expect(html).toContain("登记处理结果");
    expect(html).toContain("确认处理完成并结案");
    expect(html).not.toContain("0/0");
    expect(html).not.toContain("先整理处理方案");
    expect(html).not.toContain("进入处置");
    expect(html).toContain("处理与结案");
    expect(html).toContain("找到 ${rows.length} 件");
    expect(html).toContain("销售履约异常处理台");
    expect(html).toContain('filter((row) => row.pack === "fulfillment")');
    expect(html).toContain('id="case-picker"');
    expect(html).not.toContain("Evidence Workbench");
    expect(html).not.toContain("mock receipt");
  });

  it("does not expose implementation identifiers as primary labels", () => {
    expect(html).not.toContain("幂等键可追踪");
    expect(html).not.toContain("schemaVersion");
    expect(html).not.toContain("trace ");
    expect(html).not.toContain("本地竞赛演示环境 · tenant");
  });

  it("escapes all runtime values before injecting HTML", () => {
    expect(html).toContain("function escapeHtml(value)");
    expect(html).toContain("escapeHtml(displayTitle(gold.title))");
    expect(html).toContain("escapeHtml(e.quote)");
    expect(html).toContain("escapeHtml(c.leftValue)");
  });

  it("keeps the action sequence fail-closed in the browser", () => {
    expect(html).toContain('propose: ["new", "triaged", "confirmed"]');
    expect(html).toContain('approve: status === "proposed"');
    expect(html).toContain('execute: status === "approved"');
    expect(html).toContain('close: status === "executed" || status === "verified"');
  });

  it("uses responsive layout constraints", () => {
    expect(html).toContain("@media (max-width: 680px)");
    expect(html).toContain(".workspace { display: block; min-height: 0; height: auto; overflow: visible; }");
    expect(html).toContain("overflow-x: auto");
    expect(html).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(html).toContain(".queue { min-height: 0; overflow-y: auto;");
  });

  it("exposes an industry report endpoint for the final report view", () => {
    expect(html).toContain("核对小结");
    expect(html).toContain("/api/cases/${encodeURIComponent(currentId)}/report");
    expect(html).toContain("依据从哪里来");
  });

  it("keeps primary, investigation, and resolution content in separate levels", () => {
    expect(html).toContain('data-level-panel="overview"');
    expect(html).toContain('data-level-panel="investigate"');
    expect(html).toContain('data-level-panel="resolve"');
    expect(html).toContain(".level-panel.active");
    expect(html).not.toContain("schemaVersion");
    expect(html).not.toContain("citationIds");
    expect(html).toContain("function setLevel(level)");
    expect(html).toContain('data-level-panel="resolve"');
    expect(html).toContain('data-level-panel="investigate"');
    expect(html).toContain('resolve: ["处理与结案"');
    expect(html).toContain('investigate: ["核对证据"');
    expect(html).toContain("完成核对后开放");
    expect(html).toContain("查看依据");
    expect(html).toContain("查看全部材料");
    expect(html).toContain("核验状态");
    expect(html).toContain("完成核对后，开始拟定处理方案");
    expect(html).toContain("完成核对后可进入");
    expect(html).toContain("function canEnterResolve(gate = caseGate)");
    expect(html).toContain("reviewedConflictIds: caseGate.reviewedConflictIds");
    expect(html).toContain('if (level === "resolve" && !canEnterResolve())');
    expect(html).toContain('disabled aria-disabled="true"');
    expect(html).toContain("标记已核对");
    expect(html).toContain("data-review-conflict");
    expect(html).toContain("/api/cases/${encodeURIComponent(currentId)}/review");
  });

  it("keeps user-facing progress text out of implementation terminology", () => {
    expect(html).toContain("const actorLabel = { system: \"系统\" }");
    expect(html).toContain("const reasonLabel");
    expect(html).toContain("function displayTitle(value)");
    expect(html).toContain("没有处理范围，已安全停止");
    expect(html).toContain('<link rel="icon" href="data:," />');
  });

  it("uses the neutral light visual system with blue brand accents", () => {
    expect(html).toContain("--paper: #f5f5f7");
    expect(html).toContain("--accent: #175cd3");
    expect(html).toContain(".topbar-links");
    expect(html).toContain("border-bottom: 1px solid var(--line)");
    expect(html).toContain(".level-nav");
  });

  it("exposes capability modules beyond the case surface", () => {
    for (const label of ["孪生监控", "本体地图", "报告裁决", "推演沙盘", "行动拆解"]) expect(html).toContain(label);
    expect(html).toContain("function renderMonitor");
    expect(html).toContain("function renderOntology");
    expect(html).toContain("function renderAdjudication");
    expect(html).toContain("function renderSandbox");
    expect(html).toContain("function renderActionModule");
    expect(html).toContain("function renderMoreCapabilities");
    expect(html).toContain("来源版本对照");
    expect(html).toContain("效果回写");
    expect(html).toContain("权限与审计");
    expect(html).toContain("data-simulate");
    expect(html).toContain("data-decision");
    expect(html).toContain("/capabilities/${encodeURIComponent(currentModule)}");
    expect(html).toContain("capabilities/adjudication");
    expect(html).toContain('JSON.stringify(body)');
  });
});
