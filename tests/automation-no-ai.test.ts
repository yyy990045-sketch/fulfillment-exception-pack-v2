import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const automationSources = [
  "../src/automation/readiness.ts",
  "../src/automation/service.ts",
  "../src/automation/internal-executor.ts",
  "../src/automation/registry.ts",
];

describe("automation execution provider independence", () => {
  it("does not import or call an AI provider during execution", () => {
    for (const source of automationSources) {
      const text = readFileSync(new URL(source, import.meta.url), "utf8");
      expect(text).not.toContain("../ai/");
      expect(text).not.toContain("openai");
      expect(text).not.toContain("generateDecisionRecommendation");
      expect(text).not.toContain("generateRootCauseAnalysis");
    }
  });
});
