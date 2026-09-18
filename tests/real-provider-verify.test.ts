import { describe, expect, it } from "vitest";
import {
  injectionFailureIsSafe,
  runRealGroundedVerification,
  runRealGroundedVerificationWithOptions,
} from "../src/ai/grounded/verify-real-provider.js";
import { GroundedAiError } from "../src/ai/grounded/types.js";

describe("real grounded provider verification gate", () => {
  it("does not call a network provider without the explicit real-verification gate", async () => {
    await expect(runRealGroundedVerification({})).resolves.toEqual({ status: "disabled" });
  });

  it("returns a false blocked summary when the key is absent", async () => {
    const result = await runRealGroundedVerificationWithOptions({
      env: {
        REAL_LLM_VERIFICATION: "true",
        GROUNDING_AI_PROVIDER: "openai",
        OPENAI_GROUNDED_MODEL: "gpt-test",
      },
      writeReports: false,
    });
    expect(result.status).toBe("blocked");
    expect(result.summary).toMatchObject({
      realLlmVerified: false,
      model: "gpt-test",
      blocker: "OPENAI_API_KEY_NOT_CONFIGURED",
    });
  });

  it("does not treat provider timeout or failure as a successful adversarial firewall result", () => {
    expect(injectionFailureIsSafe(new GroundedAiError("AI_PROVIDER_TIMEOUT", 504))).toBe(false);
    expect(injectionFailureIsSafe(new GroundedAiError("AI_PROVIDER_FAILURE", 502))).toBe(false);
    expect(injectionFailureIsSafe(new GroundedAiError("AI_PROVIDER_REFUSAL", 422))).toBe(true);
  });
});
