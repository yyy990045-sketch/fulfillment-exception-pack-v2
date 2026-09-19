import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APIUserAbortError } from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import {
  DeterministicRootCauseProvider,
  OpenAIRootCauseProvider,
  buildRootCauseInput,
  buildRootCausePrompt,
  resolveRootCauseProvider,
  rootCauseJsonSchema,
  type RootCauseOpenAIResponsesClient,
} from "../src/ai/root-cause/index.js";
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
const deterministic = new DeterministicRootCauseProvider();

function request() {
  const dir = mkdtempSync(join(tmpdir(), "fep-root-cause-openai-"));
  const db = new sqlite!.DatabaseSync(join(dir, "openai.sqlite"));
  databases.push(db);
  const store = new V2SqliteStore(db);
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
  const exception = store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").find((item) => item.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
  const input = buildRootCauseInput(store, "demo-manufacturing", "ctx-so-mfg-001", exception.id);
  return { input, prompt: buildRootCausePrompt(input) };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function response(text: string, overrides: Partial<Response> = {}): Response {
  return {
    id: "resp_root_cause",
    created_at: 0,
    output_text: text,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "root-cause-test",
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
  const client: RootCauseOpenAIResponsesClient & { calls: typeof calls } = {
    calls,
    responses: { async create(body, options) { calls.push({ body, options }); return handler(body, options); } },
  };
  return client;
}

describe("OpenAI Root Cause provider", () => {
  it("uses strict Responses output without tools or storage", async () => {
    const req = request();
    const output = await deterministic.generate(req);
    const client = fakeClient(async () => response(JSON.stringify(output)));
    const provider = new OpenAIRootCauseProvider({ apiKey: "test-key", model: "root-cause-model", client });
    await provider.generate(req);
    expect(client.calls[0]!.body).toMatchObject({
      model: "root-cause-model",
      store: false,
      tools: [],
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(client.calls[0]!.options).toMatchObject({ maxRetries: 0 });
    expect(client.calls[0]!.options.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the strict hypothesis schema bounded", () => {
    const schema = rootCauseJsonSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.hypotheses.minItems).toBe(1);
    expect(schema.properties.hypotheses.maxItems).toBe(3);
    expect(schema.properties.humanVerificationRequired.const).toBe(true);
  });

  it("fails closed on refusal, incomplete, timeout, and provider errors", async () => {
    const req = request();
    const cases = [
      { client: fakeClient(async () => response("", { output: [{ id: "r", type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "no" }] }] })), code: "ROOT_CAUSE_PROVIDER_REFUSAL" },
      { client: fakeClient(async () => response("{}", { status: "incomplete" })), code: "ROOT_CAUSE_PROVIDER_INVALID_OUTPUT" },
      { client: fakeClient(async () => { throw new APIUserAbortError(); }), code: "ROOT_CAUSE_PROVIDER_TIMEOUT" },
      { client: fakeClient(async () => { throw new Error("sdk failure"); }), code: "ROOT_CAUSE_PROVIDER_FAILURE" },
    ];
    for (const item of cases) {
      const provider = new OpenAIRootCauseProvider({ apiKey: "test-key", model: "root-cause-model", client: item.client });
      await expect(provider.generate(req)).rejects.toMatchObject({ code: item.code });
    }
  });

  it("requires explicit provider configuration and keeps deterministic demo-only", () => {
    expect(() => resolveRootCauseProvider({ env: {} })).toThrow(/ROOT_CAUSE_PROVIDER_REQUIRED/);
    expect(() => resolveRootCauseProvider({ env: { ROOT_CAUSE_AI_PROVIDER: "unknown" } })).toThrow(/ROOT_CAUSE_PROVIDER_NOT_CONFIGURED/);
    expect(() => resolveRootCauseProvider({ env: { ROOT_CAUSE_AI_PROVIDER: "deterministic", DEMO_MODE: "false" } })).toThrow(/ROOT_CAUSE_PROVIDER_REQUIRED/);
    expect(resolveRootCauseProvider({ env: { ROOT_CAUSE_AI_PROVIDER: "deterministic", DEMO_MODE: "true", NODE_ENV: "test" } }).name).toBe("root-cause-deterministic-demo");
  });
});
