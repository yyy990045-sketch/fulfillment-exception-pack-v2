import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../src/workbench/operations/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/workbench/operations/app.js", import.meta.url), "utf8");

describe("operations automation work-item view", () => {
  it("exposes a read-only internal work item section", () => {
    expect(html).toContain("自动化工作项");
    expect(html).toContain("仅展示内部 Work Item，不代表经营效率提升");
    expect(app).toContain("/api/v2/internal-work-items?status=open");
    expect(app).toContain("Open internal tasks");
    expect(app).toContain("Evidence requests");
    expect(app).not.toContain("完成工作项");
    expect(app).not.toContain("删除工作项");
  });
});
