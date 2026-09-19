import { DecisionRuntimeError, type DecisionRequest, type DecisionRuntimeAuditContext, type DecisionRuntimeProvider } from "./types.js";
import { assertJsonSafe, validateDecisionAnswers } from "./validation.js";

export class DecisionRuntime {
  async evaluateBatch(provider: DecisionRuntimeProvider, request: DecisionRequest) {
    assertJsonSafe(request.state);
    if (!request.taskId.trim() || !request.questions.length) throw new DecisionRuntimeError("DECISION_RUNTIME_REQUEST_INVALID", 422);
    const providerRequest: DecisionRequest = {
      taskId: request.taskId,
      state: request.state,
      questions: request.questions,
    };
    const result = await provider.evaluateBatch(providerRequest);
    if (result.provider !== provider.name || result.model !== provider.model) {
      throw new DecisionRuntimeError("DECISION_PROVIDER_INVALID_RESPONSE:provider_identity", 502);
    }
    return {
      ...result,
      answers: validateDecisionAnswers(request.questions, result.answers),
    };
  }

  async boolean(provider: DecisionRuntimeProvider, request: Omit<DecisionRequest, "questions"> & { question: Extract<DecisionRequest["questions"][number], { type: "boolean" }> }) {
    const result = await this.evaluateBatch(provider, { ...request, questions: [request.question] });
    return result.answers[0]!;
  }

  async choice(provider: DecisionRuntimeProvider, request: Omit<DecisionRequest, "questions"> & { question: Extract<DecisionRequest["questions"][number], { type: "choice" }> }) {
    const result = await this.evaluateBatch(provider, { ...request, questions: [request.question] });
    return result.answers[0]!;
  }

  async score(provider: DecisionRuntimeProvider, request: Omit<DecisionRequest, "questions"> & { question: Extract<DecisionRequest["questions"][number], { type: "score" }> }) {
    const result = await this.evaluateBatch(provider, { ...request, questions: [request.question] });
    return result.answers[0]!;
  }

  async classify(provider: DecisionRuntimeProvider, request: Omit<DecisionRequest, "questions"> & { question: Extract<DecisionRequest["questions"][number], { type: "choice" }> }) {
    return this.choice(provider, request);
  }
}
