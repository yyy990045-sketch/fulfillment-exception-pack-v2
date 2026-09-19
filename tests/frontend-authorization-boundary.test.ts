import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const governance = readFileSync(
  new URL("../frontend/src/features/manufacturing/components/governance-process.tsx", import.meta.url),
  "utf8",
);
const appShell = readFileSync(
  new URL("../frontend/src/app/app-shell.tsx", import.meta.url),
  "utf8",
);

describe("frontend authorization boundary", () => {
  it("does not duplicate backend role, SoD, or approval eligibility decisions", () => {
    for (const source of [governance, appShell]) {
      expect(source).not.toContain("DEMO_ASSIGNABLE_OWNER_ROLES");
      expect(source).not.toContain("SEGREGATION_OF_DUTIES_VIOLATION");
      expect(source).not.toMatch(/roles?\.includes\(/);
      expect(source).not.toMatch(/role\s*===/);
      for (const role of ["品质负责人", "销售总监", "工程师", "财务", "总经理", "管理员"]) {
        expect(source).not.toContain(role);
      }
    }
  });

  it("renders action availability from backend capabilities", () => {
    expect(governance).toContain("resolutionCapabilities.canAccept.applicable");
    expect(governance).toContain("resolutionCapabilities.canApprove");
    expect(governance).toContain("resolutionCapabilities.canExecute");
    expect(governance).toContain("resolutionCapabilities.canClose");
    expect(governance).toContain("capability.reason");
  });
});
