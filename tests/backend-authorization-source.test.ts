import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authorization = readFileSync(new URL("../src/authorization.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/case/runtime.ts", import.meta.url), "utf8");
const resolutionRuntime = readFileSync(new URL("../src/domain/v2/resolution/runtime.ts", import.meta.url), "utf8");
const capabilities = readFileSync(new URL("../src/domain/v2/resolution/capabilities.ts", import.meta.url), "utf8");

const ownerRoleArray = '[ "品质负责人", "销售总监", "工程师", "财务", "总经理", "管理员", ]';
const approverRoleArray = '[ "总经理", "管理员", "销售总监", "财务", "工程师", ]';
const compact = (source: string) => source.replace(/\s+/g, " ");

describe("backend authorization source of truth", () => {
  it("keeps policy role lists in one module", () => {
    expect(compact(authorization)).toContain(ownerRoleArray);
    expect(compact(authorization)).toContain(approverRoleArray);
    for (const source of [auth, runtime, resolutionRuntime, capabilities]) {
      expect(compact(source)).not.toContain(ownerRoleArray);
      expect(compact(source)).not.toContain(approverRoleArray);
    }
  });
});
