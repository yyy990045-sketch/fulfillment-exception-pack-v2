import { describe, expect, it } from "vitest";
import type { Response } from "openai/resources/responses/responses.js";
import {
  DeterministicGroundedAiProvider,
  resolveGroundedAiProvider,
  type OpenAIResponsesClient,
} from "../src/ai/grounded/index.js";

function fakeClient(): OpenAIResponsesClient {
  return {
    responses: {
      async create() {
        return { output_text: "" } as Response;
      },
    },
  };
}

describe("grounded provider registry", () => {
  it("requires the deterministic provider to be explicitly enabled in demo mode", () => {
    const provider = resolveGroundedAiProvider({
      env: { GROUNDING_AI_PROVIDER: "deterministic", DEMO_MODE: "true", NODE_ENV: "test" },
    });
    expect(provider).toBeInstanceOf(DeterministicGroundedAiProvider);
    expect(provider.name).toBe("deterministic-demo");

    expect(() => resolveGroundedAiProvider({
      env: { DEMO_MODE: "true", NODE_ENV: "test" },
    })).toThrow(/GROUNDING_AI_PROVIDER_REQUIRED/);
    expect(() => resolveGroundedAiProvider({
      env: { GROUNDING_AI_PROVIDER: "deterministic", DEMO_MODE: "false", NODE_ENV: "test" },
    })).toThrow(/GROUNDING_AI_PROVIDER_REQUIRED/);
  });

  it("requires explicit OpenAI key and model", () => {
    expect(() => resolveGroundedAiProvider({
      env: { GROUNDING_AI_PROVIDER: "openai", OPENAI_GROUNDED_MODEL: "gpt-test" },
      openAIClient: fakeClient(),
    })).toThrow(/AI_PROVIDER_NOT_CONFIGURED/);
    expect(() => resolveGroundedAiProvider({
      env: { GROUNDING_AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
      openAIClient: fakeClient(),
    })).toThrow(/AI_PROVIDER_NOT_CONFIGURED/);
  });

  it("returns OpenAI in demo or production only when explicitly configured", () => {
    const demo = resolveGroundedAiProvider({
      env: {
        GROUNDING_AI_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_GROUNDED_MODEL: "gpt-test",
        DEMO_MODE: "true",
        NODE_ENV: "test",
      },
      openAIClient: fakeClient(),
    });
    expect(demo.name).toBe("openai");
    expect(demo.model).toBe("gpt-test");

    const production = resolveGroundedAiProvider({
      env: {
        GROUNDING_AI_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_GROUNDED_MODEL: "gpt-test",
        NODE_ENV: "production",
      },
      openAIClient: fakeClient(),
    });
    expect(production.name).toBe("openai");
  });

  it("rejects unknown providers", () => {
    expect(() => resolveGroundedAiProvider({
      env: { GROUNDING_AI_PROVIDER: "anthropic" },
      openAIClient: fakeClient(),
    })).toThrow(/AI_PROVIDER_NOT_CONFIGURED/);
  });
});
