import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APIUserAbortError } from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import {
  DeterministicDecisionRecommendationProvider,
  OpenAIDecisionRecommendationProvider,
  buildDecisionRecommendationInput,
  buildDecisionRecommendationPrompt,
  decisionRecommendationJsonSchema,
  resolveDecisionRecommendationProvider,
  type DecisionOpenAIResponsesClient,
} from "../src/ai/decision/index.js";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
} from "../src/domain/v2/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];
const deterministic = new DeterministicDecisionRecommendationProvider();

function request() {
  const dir = mkdtempSync(join(tmpdir(), "fep-decision-openai-"));
  const db = new sqlite!.DatabaseSync(join(dir, "openai.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  const exception = store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
  const input = buildDecisionRecommendationInput(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id);
  return { input, prompt: buildDecisionRecommendationPrompt(input) };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function response(text: string, overrides: Partial<Response> = {}): Response {
  return {
    id: "resp_decision",
    created_at: 0,
    output_text: text,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "decision-test",
    object: "response",
    output: [{ id: "msg", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: null,
    status: "completed",
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: null,
    user: null,
    ...overrides,
  } as Response;
}

function fakeClient(handler: (body: ResponseCreateParamsNonStreaming, options?: any) => Promise<Response>) {
  const calls: Array<{ body: ResponseCreateParamsNonStreaming; options?: any }> = [];
  const client: DecisionOpenAIResponsesClient & { calls: typeof calls } = {
    calls,
    responses: { async create(body, options) { calls.push({ body, options }); return handler(body, options); } },
  };
  return client;
}

describe("OpenAI Decision Recommendation provider", () => {
  it("uses Responses Structured Outputs with store=false and no tools", async () => {
    const req = request();
    const output = await deterministic.generate(req);
    const client = fakeClient(async () => response(JSON.stringify(output)));
    const provider = new OpenAIDecisionRecommendationProvider({ apiKey: "test-key", model: "decision-model", client });
    await provider.generate(req);
    expect(client.calls[0]!.body).toMatchObject({
      model: "decision-model",
      store: false,
      tools: [],
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(client.calls[0]!.options).toMatchObject({ maxRetries: 0 });
    expect(client.calls[0]!.options.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the strict decision schema complete", () => {
    const schema = decisionRecommendationJsonSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.options.minItems).toBe(1);
    expect(schema.properties.options.maxItems).toBe(3);
    expect(schema.properties.humanDecisionRequired.const).toBe(true);
  });

  it("fails closed on empty, refusal, incomplete, and timeout responses", async () => {
    const req = request();
    const cases = [
      { client: fakeClient(async () => response("")), code: "DECISION_PROVIDER_INVALID_OUTPUT" },
      { client: fakeClient(async () => response("", { output: [{ id: "r", type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "no" }] }] })), code: "DECISION_PROVIDER_REFUSAL" },
      { client: fakeClient(async () => response("{}", { status: "incomplete" })), code: "DECISION_PROVIDER_INVALID_OUTPUT" },
      { client: fakeClient(async () => { throw new APIUserAbortError(); }), code: "DECISION_PROVIDER_TIMEOUT" },
    ];
    for (const item of cases) {
      const provider = new OpenAIDecisionRecommendationProvider({ apiKey: "test-key", model: "decision-model", client: item.client });
      await expect(provider.generate(req)).rejects.toMatchObject({ code: item.code });
    }
  });

  it("requires explicit deterministic or OpenAI provider configuration", () => {
    expect(() => resolveDecisionRecommendationProvider({ env: {} })).toThrow(/DECISION_PROVIDER_REQUIRED/);
    expect(() => resolveDecisionRecommendationProvider({ env: { DECISION_AI_PROVIDER: "unknown-provider" } })).toThrow(/DECISION_PROVIDER_NOT_CONFIGURED/);
    expect(() => resolveDecisionRecommendationProvider({ env: { DECISION_AI_PROVIDER: "openai", OPENAI_DECISION_MODEL: "model" } })).toThrow(/DECISION_PROVIDER_NOT_CONFIGURED/);
    expect(() => resolveDecisionRecommendationProvider({ env: { DECISION_AI_PROVIDER: "deterministic", DEMO_MODE: "false", NODE_ENV: "test" } })).toThrow(/DECISION_PROVIDER_REQUIRED/);
    expect(() => resolveDecisionRecommendationProvider({ env: { DECISION_AI_PROVIDER: "deterministic", DEMO_MODE: "true", NODE_ENV: "production" } })).toThrow(/DECISION_PROVIDER_REQUIRED/);
    expect(resolveDecisionRecommendationProvider({ env: { DECISION_AI_PROVIDER: "deterministic", DEMO_MODE: "true", NODE_ENV: "test" } }).name).toBe("decision-deterministic-demo");
  });

  it("does not expose the API key in provider failures", async () => {
    const req = request();
    const secret = "sk-decision-secret";
    const provider = new OpenAIDecisionRecommendationProvider({
      apiKey: secret,
      model: "decision-model",
      client: fakeClient(async () => { throw new Error(secret); }),
    });
    let message = "";
    try { await provider.generate(req); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toBe("DECISION_PROVIDER_FAILURE");
    expect(message).not.toContain(secret);
  });
});
