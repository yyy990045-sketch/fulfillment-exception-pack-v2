import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../src/workbench/manufacturing/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/workbench/manufacturing/app.js", import.meta.url), "utf8");

describe("manufacturing decision recommendation UI contract", () => {
  it("keeps the decision tab manual and bounded", () => {
    expect(html).toContain('id="tab-decision"');
    expect(html).toContain('id="panel-decision"');
    expect(html.indexOf('id="tab-ai"')).toBeLessThan(html.indexOf('id="tab-decision"'));
    expect(html.indexOf('id="tab-decision"')).toBeLessThan(html.indexOf('id="tab-resolution"'));
    expect(html).toContain('id="tab-root-cause"');
    expect(html.indexOf('id="tab-ai"')).toBeLessThan(html.indexOf('id="tab-root-cause"'));
    expect(html.indexOf('id="tab-root-cause"')).toBeLessThan(html.indexOf('id="tab-decision"'));
    expect(app).toContain("尚未基于当前证据与历史治理记录生成决策建议。");
    expect(app).toContain("生成决策建议");
    expect(app).toContain('method: "POST", body: {}');
  });

  it("shows the required recommendation context without auto-advancing Resolution", () => {
    expect(app).toContain("ACTION_TYPES[option.actionType]");
    expect(app).toContain("前提假设");
    expect(app).toContain("尚不确定");
    expect(app).toContain("历史动作次数仅表示过去的治理记录，不代表方案有效性或成功率。");
    expect(app).toContain("填入人工方案草稿");
    expect(app).toContain("内容来源于 AI Recommendation，提交前请人工核对和修改。");
    expect(app).toContain("该建议未通过 Grounding 与 Action Eligibility 校验");
  });

  it("keeps root cause hypotheses visibly provisional and human reviewed", () => {
    expect(app).toContain("尚未生成原因假设。");
    expect(app).toContain("生成原因假设");
    expect(app).toContain("待验证假设");
    expect(app).toContain("以下内容均为待验证假设，不代表根因、事实或责任结论。");
    expect(app).toContain("进入调查");
    expect(app).toContain("需要更多证据");
    expect(app).toContain("假设复核已记录，未确认根因或责任。");
  });
});
