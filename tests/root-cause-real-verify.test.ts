import { describe, expect, it } from "vitest";
import { runRootCauseRealVerification } from "../src/ai/root-cause/verify-real-provider.js";

describe("root cause real provider gate", () => {
  it("stays disabled unless explicitly enabled", async () => {
    await expect(runRootCauseRealVerification({})).resolves.toEqual({ status: "disabled" });
  });
});
