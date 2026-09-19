import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DecisionProviderRegistry,
  DecisionRuntime,
  JevDecisionRuntimeProvider,
  OpenAIDecisionRuntimeProvider,
  resolveDecisionRuntimeProvider,
  type DecisionBatchResult,
  type DecisionQuestion,
  type DecisionRuntimeProvider,
} from "../src/intelligence/decision-runtime/index.js";
import type { DecisionRuntimeError } from "../src/intelligence/decision-runtime/types.js";
import { V2SqliteStore } from "../src/domain/v2/sqlite-store.js";
import { evaluateWithAudit } from "../src/intelligence/decision-runtime/audit.js";
import { validateDecisionAnswers } from "../src/intelligence/decision-runtime/validation.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
};
type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const databases: DatabaseSyncLike[] = [];

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "fep-decision-runtime-"));
  const db = new sqlite!.DatabaseSync(join(dir, "runtime.sqlite"));
  databases.push(db);
  return new V2SqliteStore(db);
}

const questions: DecisionQuestion[] = [
  { id: "gate", type: "boolean", instructions: "human gate?", criteria: { true: "yes", false: "no" } },
  { id: "action", type: "choice", instructions: "action?", criteria: { create_task: "task", review_quotation: "review" } },
  { id: "risk", type: "score", instructions: "risk?", criteria: ["low", "medium", "high"] },
];

const officialQuestions: DecisionQuestion[] = [
  {
    id: "department",
    type: "choice",
    instructions: "Choose the department.",
    criteria: { billing: "Billing", technical: "Technical", sales: "Sales" },
  },
  {
    id: "frustration",
    type: "score",
    instructions: "Score the customer frustration level.",
    criteria: ["Calm", "Frustrated", "Very angry"],
  },
  {
    id: "is_urgent",
    type: "boolean",
    instructions: "Is this urgent?",
    criteria: { true: "Urgent", false: "Not urgent" },
  },
];

function officialAnswers() {
  return {
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.84, technical: 0.159, sales: 0.001 },
      confidence: 0.596,
    },
    frustration: {
      type: "score",
      score: 1.3,
      legend: { 0: "Calm", 1: "Frustrated", 2: "Very angry" },
      probabilities: { 0: 0, 1: 0.7, 2: 0.3 },
      confidence: 0.54,
    },
    is_urgent: {
      type: "noul",
      noul: 0.999,
    },
  };
}

function jevProvider(readBody: () => Record<string, unknown>) {
  return new JevDecisionRuntimeProvider({
    apiKey: "test",
    model: "jev-latest",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => readBody(),
    }) as Response,
  });
}

class CapturingProvider implements DecisionRuntimeProvider {
  readonly name = "capture";
  readonly model = "capture-v1";
  request: unknown;
  async evaluateBatch(request: Parameters<DecisionRuntimeProvider["evaluateBatch"]>[0]): Promise<DecisionBatchResult> {
    this.request = request;
    return {
      provider: this.name,
      model: this.model,
      answers: [
        { questionId: "gate", type: "boolean", value: true, probabilityYes: 0.8, confidence: null, confidenceKind: "probability_only" },
        { questionId: "action", type: "choice", choice: "create_task", probabilities: { create_task: 0.7, review_quotation: 0.3 }, confidence: 0.7, confidenceKind: "self_reported" },
        { questionId: "risk", type: "score", score: 1, legend: "medium", probabilities: [0.1, 0.8, 0.1], confidence: 0.8, confidenceKind: "provider_reported_calibrated" },
      ],
    };
  }
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Provider-neutral Decision Runtime", () => {
  it("normalizes boolean, choice, and score answers in one batch", async () => {
    const runtime = new DecisionRuntime();
    const result = await runtime.evaluateBatch(new CapturingProvider(), { taskId: "task-a", state: { amount: 100 }, questions });
    expect(result.answers).toHaveLength(3);
    expect(result.answers[0]).toMatchObject({ type: "boolean", value: true, probabilityYes: 0.8 });
    expect(result.answers[1]).toMatchObject({ type: "choice", choice: "create_task" });
    expect(result.answers[2]).toMatchObject({ type: "score", score: 1 });
  });

  it("registers providers and rejects duplicate identities", () => {
    const registry = new DecisionProviderRegistry();
    const first = new CapturingProvider();
    registry.register(first);
    expect(registry.get("capture")?.model).toBe("capture-v1");
    const duplicate = new CapturingProvider();
    Object.defineProperty(duplicate, "model", { value: "other" });
    expect(() => registry.register(duplicate)).toThrow(/DECISION_PROVIDER_ID_CONFLICT/);
  });

  it("rejects malformed probabilities and out-of-range scores", () => {
    expect(() => validateDecisionAnswers(questions, [
      { questionId: "gate", type: "boolean", value: true, probabilityYes: 1, confidence: 1, confidenceKind: "deterministic" },
      { questionId: "action", type: "choice", choice: "create_task", probabilities: { create_task: 0.9, review_quotation: 0.4 }, confidence: 1, confidenceKind: "deterministic" },
      { questionId: "risk", type: "score", score: 1, legend: "medium", probabilities: [0.1, 0.8, 0.1], confidence: 1, confidenceKind: "deterministic" },
    ])).toThrow(/DECISION_PROVIDER_INVALID_RESPONSE/);
    expect(() => validateDecisionAnswers(questions, [
      { questionId: "gate", type: "boolean", value: true, probabilityYes: 1, confidence: 1, confidenceKind: "deterministic" },
      { questionId: "action", type: "choice", choice: "create_task", probabilities: { create_task: 1, review_quotation: 0 }, confidence: 1, confidenceKind: "deterministic" },
      { questionId: "risk", type: "score", score: 9, legend: "bad", probabilities: null, confidence: 1, confidenceKind: "deterministic" },
    ])).toThrow(/DECISION_PROVIDER_INVALID_RESPONSE/);
    expect(validateDecisionAnswers(questions, [
      { questionId: "gate", type: "boolean", value: true, probabilityYes: 1, confidence: 1, confidenceKind: "deterministic" },
      { questionId: "action", type: "choice", choice: "create_task", probabilities: { create_task: 1, review_quotation: 0 }, confidence: 1, confidenceKind: "deterministic" },
      { questionId: "risk", type: "score", score: 1.3, legend: null, probabilities: [0, 0.7, 0.3], confidence: 1, confidenceKind: "deterministic" },
    ])).toMatchObject([{ type: "boolean" }, { type: "choice" }, { type: "score", score: 1.3 }]);
  });

  it("maps the official Jev object-map request and response shapes", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new JevDecisionRuntimeProvider({
      apiKey: "test",
      model: "jev-latest",
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          model: "jev-latest",
          answers: officialAnswers(),
          usage: { input_tokens: 312, output_tokens: 48 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const result = await provider.evaluateBatch({ taskId: "task-a", state: {}, questions: officialQuestions });

    expect(Array.isArray(requestBody?.questions)).toBe(false);
    expect(requestBody?.questions).toEqual({
      department: {
        type: "choice",
        instructions: "Choose the department.",
        criteria: { billing: "Billing", technical: "Technical", sales: "Sales" },
      },
      frustration: {
        type: "score",
        instructions: "Score the customer frustration level.",
        criteria: ["Calm", "Frustrated", "Very angry"],
      },
      is_urgent: {
        type: "noul",
        instructions: "Is this urgent?",
        criteria: { true: "Urgent", false: "Not urgent" },
      },
    });

    expect(result.answers).toEqual([
      {
        questionId: "department",
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.84, technical: 0.159, sales: 0.001 },
        confidence: 0.596,
        confidenceKind: "provider_reported_calibrated",
      },
      {
        questionId: "frustration",
        type: "score",
        score: 1.3,
        legend: null,
        probabilities: [0, 0.7, 0.3],
        confidence: 0.54,
        confidenceKind: "provider_reported_calibrated",
      },
      {
        questionId: "is_urgent",
        type: "boolean",
        value: true,
        probabilityYes: 0.999,
        confidence: null,
        confidenceKind: "probability_only",
      },
    ]);
    expect(result.usage).toEqual({ input_tokens: 312, output_tokens: 48 });
  });

  it("rejects malformed OpenAI probabilities at the provider boundary", async () => {
    const provider = new OpenAIDecisionRuntimeProvider({
      apiKey: "test",
      model: "explicit-test-model",
      client: {
        responses: {
          create: async () => ({
            id: "resp-test",
            status: "completed",
            output: [],
            output_text: JSON.stringify({
              answers: [
                { questionId: "gate", type: "boolean", value: true, probabilityYes: 0.8, confidence: 0.8 },
                { questionId: "action", type: "choice", choice: "create_task", probabilities: { create_task: 0.8, review_quotation: 0.4 }, confidence: 0.8 },
                { questionId: "risk", type: "score", score: 1, legend: "medium", probabilities: [0.1, 0.8, 0.1], confidence: 0.8 },
              ],
            }),
          } as never),
        },
      },
    });
    await expect(provider.evaluateBatch({ taskId: "task-a", state: {}, questions })).rejects.toThrow(/DECISION_PROVIDER_INVALID_RESPONSE/);
  });

  it("fails closed for malformed official Jev responses", async () => {
    const missingQuestion = officialAnswers();
    delete (missingQuestion as Partial<typeof missingQuestion>).is_urgent;
    const wrongProbabilityKeys = officialAnswers();
    delete (wrongProbabilityKeys.department.probabilities as Record<string, number>).sales;
    const scoreOutOfRange = officialAnswers();
    scoreOutOfRange.frustration.score = 2.1;
    const scoreNaN = officialAnswers();
    scoreNaN.frustration.score = Number.NaN;
    const unknownChoice = officialAnswers();
    unknownChoice.department.choice = "unknown";
    const probabilitySum = officialAnswers();
    probabilitySum.department.probabilities = { billing: 0.5, technical: 0.5, sales: 0.2 };
    const invalidConfidence = officialAnswers();
    invalidConfidence.department.confidence = 1.2;
    const wrongAnswerType = officialAnswers();
    wrongAnswerType.department.type = "score";
    const unknownQuestion = { ...officialAnswers(), extra_question: { type: "noul", noul: 1 } };

    const cases = [
      { answers: missingQuestion },
      { answers: wrongProbabilityKeys },
      { answers: scoreOutOfRange },
      { answers: scoreNaN },
      { answers: unknownChoice },
      { answers: probabilitySum },
      { answers: invalidConfidence },
      { answers: wrongAnswerType },
      { answers: unknownQuestion },
      { answers: [] },
    ];

    for (const body of cases) {
      await expect(jevProvider(() => body).evaluateBatch({
        taskId: "task-a",
        state: {},
        questions: officialQuestions,
      })).rejects.toThrow(/DECISION_PROVIDER_INVALID_RESPONSE/);
    }

    await expect(jevProvider(() => ({ answers: officialAnswers() })).evaluateBatch({
      taskId: "task-a",
      state: {},
      questions: [officialQuestions[0]!, officialQuestions[0]!],
    })).rejects.toThrow(/DECISION_PROVIDER_INVALID_RESPONSE:duplicate_question_id/);
  });

  it("maps OpenAI timeout to a stable provider error", async () => {
    const provider = new OpenAIDecisionRuntimeProvider({
      apiKey: "test",
      model: "explicit-test-model",
      timeoutMs: 1,
      client: {
        responses: {
          create: async (_body, options) => new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        },
      },
    });
    await expect(provider.evaluateBatch({ taskId: "task-a", state: {}, questions }))
      .rejects.toMatchObject({ code: "DECISION_PROVIDER_TIMEOUT", status: 504 });
  });

  it("maps Jev timeout to a stable provider error", async () => {
    const provider = new JevDecisionRuntimeProvider({
      apiKey: "test",
      model: "jev-latest",
      timeoutMs: 1,
      fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    await expect(provider.evaluateBatch({ taskId: "task-a", state: {}, questions }))
      .rejects.toMatchObject({ code: "DECISION_PROVIDER_TIMEOUT", status: 504 });
  });

  it("does not fall back when the explicitly selected provider fails", async () => {
    const failing: DecisionRuntimeProvider = {
      name: "failing",
      model: "failing-v1",
      async evaluateBatch() {
        throw new Error("provider failed");
      },
    };
    let fallbackCalls = 0;
    const fallback: DecisionRuntimeProvider = {
      name: "fallback",
      model: "fallback-v1",
      async evaluateBatch() {
        fallbackCalls += 1;
        return { provider: "fallback", model: "fallback-v1", answers: [] };
      },
    };
    const registry = new DecisionProviderRegistry();
    registry.register(failing);
    registry.register(fallback);
    await expect(new DecisionRuntime().evaluateBatch(registry.get("failing")!, { taskId: "task-a", state: {}, questions }))
      .rejects.toThrow("provider failed");
    expect(fallbackCalls).toBe(0);
  });

  it("fails closed for missing keys and explicit provider selection", () => {
    expect(() => resolveDecisionRuntimeProvider({ provider: "jev", env: {} })).toThrow(/DECISION_PROVIDER_NOT_CONFIGURED/);
    expect(() => resolveDecisionRuntimeProvider({ provider: "openai", env: {} })).toThrow(/DECISION_PROVIDER_NOT_CONFIGURED/);
    expect(() => resolveDecisionRuntimeProvider({ provider: "unknown", env: {} })).toThrow(/DECISION_PROVIDER_NOT_CONFIGURED/);
  });

  it("passes only the provider request contract and drops undeclared top-level metadata", async () => {
    const provider = new CapturingProvider();
    const request = {
      taskId: "benchmark-task",
      state: { evidence: ["e1"] },
      questions,
      expected: "should-not-leak",
      referenceLabel: "also-not-allowed",
    } as unknown as Parameters<DecisionRuntime["evaluateBatch"]>[1];
    await new DecisionRuntime().evaluateBatch(provider, request);
    const serialized = JSON.stringify(provider.request);
    expect(serialized).toContain("taskId");
    expect(serialized).toContain("questions");
    expect(serialized).not.toContain("should-not-leak");
    expect(serialized).not.toContain("referenceLabel");
    expect(serialized).not.toContain("expectedAnswer");
  });

  it("audits hashes and normalized answers without storing raw state", async () => {
    const store = openStore();
    const provider = new CapturingProvider();
    await evaluateWithAudit(store, provider, {
      taskId: "audit-task",
      state: { secretCustomerValue: "do-not-store" },
      questions,
    }, { tenantId: "tenant-a", actor: "evaluator" });
    const call = store.listDecisionRuntimeCalls("tenant-a", "audit-task")[0]!;
    expect(call.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(call)).not.toContain("do-not-store");
    expect(store.listDecisionRuntimeCalls("tenant-b", "audit-task")).toHaveLength(0);
  });
});
