import type { AutomationEffect, AutomationExecutionInput, AutomationExecutor } from "./types.js";

function taskEffect(input: AutomationExecutionInput): AutomationEffect {
  const title = `复核异常：${input.exceptionTitle}`;
  return {
    kind: "task",
    title,
    description: `针对当前异常创建内部复核任务。ActionType=${input.actionType}。`,
    metadata: {
      policyEvaluationId: input.policyEvaluation.id,
      deterministicTemplate: "internal-review-task/v1",
    },
  };
}

function evidenceRequestEffect(input: AutomationExecutionInput): AutomationEffect {
  return {
    kind: "evidence_request",
    title: "补充异常核验材料",
    description: `需要针对当前异常补充核验材料。ActionType=${input.actionType}。`,
    metadata: {
      policyEvaluationId: input.policyEvaluation.id,
      deterministicTemplate: "internal-evidence-request/v1",
    },
  };
}

export class InternalAutomationExecutor implements AutomationExecutor {
  readonly name = "internal";
  readonly version = "internal-work-item-v1";

  supports(actionType: AutomationExecutionInput["actionType"]) {
    return actionType === "create_task" || actionType === "supplement_evidence";
  }

  execute(input: AutomationExecutionInput): AutomationEffect {
    if (input.actionType === "create_task") return taskEffect(input);
    if (input.actionType === "supplement_evidence") return evidenceRequestEffect(input);
    throw new Error("AUTOMATION_ACTION_NOT_SUPPORTED");
  }
}
