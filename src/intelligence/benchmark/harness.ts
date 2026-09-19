import { DecisionRuntime, type DecisionAnswer, type DecisionRuntimeProvider } from "../decision-runtime/index.js";
import type { BenchmarkCase, BenchmarkCaseResult, BenchmarkProviderRun } from "./types.js";

const RESERVED_LABEL_KEYS = new Set(["expected", "expectedAnswer", "referenceAnswers", "referenceLabel"]);

export function stripBenchmarkMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBenchmarkMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !RESERVED_LABEL_KEYS.has(key))
      .map(([key, item]) => [key, stripBenchmarkMetadata(item)]),
  );
}

function answerMatches(answer: DecisionAnswer, expected: unknown) {
  if (answer.type === "boolean") return answer.value === expected;
  if (answer.type === "choice") return answer.choice === expected;
  return answer.score === expected;
}

function caseResult(
  caseItem: BenchmarkCase,
  answer: DecisionAnswer | undefined,
  latencyMs: number,
  error?: unknown,
  usage?: Record<string, unknown>,
): BenchmarkCaseResult {
  const expected = caseItem.referenceAnswers[answer?.questionId ?? caseItem.questions[0]!.id];
  const exact = Boolean(answer && expected !== undefined && answerMatches(answer, expected));
  const unsafe = Boolean(answer && caseItem.unsafeAnswers?.some((item) => answerMatches(answer, item)));
  return {
    caseId: caseItem.id,
    suite: caseItem.suite,
    domain: caseItem.domain,
    status: error ? "failed" : "succeeded",
    latencyMs,
    ...(answer ? { answer } : {}),
    reference: expected!,
    ...(usage ? { usage } : {}),
    exact,
    unsafe,
    ...(error instanceof Error && "code" in error && typeof error.code === "string" ? { errorCode: error.code } : {}),
  };
}

async function evaluateCase(runtime: DecisionRuntime, provider: DecisionRuntimeProvider, caseItem: BenchmarkCase): Promise<BenchmarkCaseResult> {
  const startedAt = performance.now();
  try {
    const result = await runtime.evaluateBatch(provider, {
      taskId: caseItem.id,
      state: stripBenchmarkMetadata(caseItem.state),
      questions: caseItem.questions,
    });
    const answer = result.answers.find((item) => item.questionId === caseItem.questions[0]!.id);
    if (!answer) throw new Error("DECISION_PROVIDER_INVALID_RESPONSE:answer_missing");
    return caseResult(caseItem, answer, performance.now() - startedAt, undefined, result.usage);
  } catch (error) {
    return caseResult(caseItem, undefined, performance.now() - startedAt, error);
  }
}

export async function runProviderBenchmark(
  provider: DecisionRuntimeProvider,
  cases: BenchmarkCase[],
  options: { warmup?: boolean } = {},
): Promise<BenchmarkProviderRun> {
  const runtime = new DecisionRuntime();
  let warmupUsed = false;
  if (options.warmup && cases[0]) {
    const warmup = await evaluateCase(runtime, provider, cases[0]);
    if (warmup.status === "failed") throw new Error(warmup.errorCode ?? "DECISION_PROVIDER_FAILURE");
    warmupUsed = true;
  }
  const results: BenchmarkCaseResult[] = [];
  for (const caseItem of cases) results.push(await evaluateCase(runtime, provider, caseItem));
  return { provider, warmupUsed, results };
}
