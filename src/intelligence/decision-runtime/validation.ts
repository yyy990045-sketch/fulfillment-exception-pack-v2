import {
  DecisionRuntimeError,
  type ChoiceDecisionAnswer,
  type DecisionAnswer,
  type DecisionQuestion,
  type ScoreDecisionAnswer,
} from "./types.js";

function probability(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}`);
  }
  return value;
}

function probabilityMap(value: unknown, criteria: Record<string, string>, path: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}`);
  const record = value as Record<string, unknown>;
  const expected = Object.keys(criteria);
  const actual = Object.keys(record);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) {
    throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}.keys`);
  }
  const probabilities = Object.fromEntries(expected.map((key) => [key, probability(record[key], `${path}.${key}`)]));
  const sum = Object.values(probabilities).reduce((total, item) => total + item, 0);
  if (sum < 0.98 || sum > 1.02) throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}.sum`);
  return probabilities;
}

function scoreProbabilityMap(value: unknown, criteria: string[], path: string) {
  if (!Array.isArray(value) || value.length !== criteria.length) throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}`);
  const probabilities = value.map((item, index) => probability(item, `${path}[${index}]`));
  const sum = probabilities.reduce((total, item) => total + item, 0);
  if (sum < 0.98 || sum > 1.02) throw new DecisionRuntimeError(`DECISION_PROVIDER_INVALID_RESPONSE:${path}.sum`);
  return probabilities;
}

export function validateDecisionAnswers(questions: DecisionQuestion[], answers: DecisionAnswer[]): DecisionAnswer[] {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  if (answers.length !== questions.length) throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:answer_count");
  const seen = new Set<string>();
  return answers.map((answer) => {
    const question = questionById.get(answer.questionId);
    if (!question || seen.has(answer.questionId)) throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:question_id");
    seen.add(answer.questionId);
    if (question.type !== answer.type) throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:answer_type");
    if (answer.type === "boolean") {
      if (typeof answer.value !== "boolean") throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:boolean");
      if (answer.probabilityYes !== null) probability(answer.probabilityYes, `${answer.questionId}.probabilityYes`);
      return answer;
    }
    if (question.type === "choice") {
      if (answer.type !== "choice") throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:answer_type");
      if (!(answer.choice in question.criteria)) throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:choice");
      const probabilities = answer.probabilities === null ? null : probabilityMap(answer.probabilities, question.criteria, `${answer.questionId}.probabilities`);
      return { ...answer, probabilities } satisfies ChoiceDecisionAnswer;
    }
    if (question.type !== "score" || answer.type !== "score") throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:answer_type");
    if (!Number.isInteger(answer.score) || answer.score < 0 || answer.score >= question.criteria.length) {
      throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:score");
    }
    const probabilities = answer.probabilities === null ? null : scoreProbabilityMap(answer.probabilities, question.criteria, `${answer.questionId}.probabilities`);
    return { ...answer, probabilities } satisfies ScoreDecisionAnswer;
  });
}

export function assertJsonSafe(value: unknown, path = "state"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DecisionRuntimeError(`DECISION_RUNTIME_STATE_NOT_JSON_SAFE:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) assertJsonSafe(item, `${path}.${key}`);
    return;
  }
  throw new DecisionRuntimeError(`DECISION_RUNTIME_STATE_NOT_JSON_SAFE:${path}`);
}
