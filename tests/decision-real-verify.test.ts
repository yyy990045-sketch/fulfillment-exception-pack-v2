import { describe, expect, it } from "vitest";
import { runDecisionRealVerification } from "../src/ai/decision/verify-real-provider.js";

describe("decision real provider gate", () => {
  it("stays disabled unless explicitly enabled", async () => {
    await expect(runDecisionRealVerification({})).resolves.toEqual({ status: "disabled" });
  });
});
