import type { DecisionRecommendationInput, DecisionRecommendationOutput, DecisionRecommendationProvider, DecisionOption } from "./types.js";

function observation(input: DecisionRecommendationInput, key: string) {
  const item = input.evaluation.observations[key];
  return item?.status === "resolved" && typeof item.value === "number" ? item : undefined;
}

function metric(input: DecisionRecommendationInput, key: string) {
  return typeof input.evaluation.metrics[key] === "number" ? input.evaluation.metrics[key] : undefined;
}

function option(input: DecisionRecommendationInput, actionType: DecisionOption["actionType"], title: string, summary: string, rationale: string): DecisionOption {
  const observed = Object.entries(input.evaluation.observations).flatMap(([key, item]) =>
    item.status === "resolved" && typeof item.value === "number"
      ? [{ kind: "actual" as const, key, value: item.value, evidenceIds: item.evidenceIds }]
      : [],
  );
  const metrics = Object.entries(input.evaluation.metrics).map(([key, value]) => ({ kind: "metric" as const, key, value, evidenceIds: input.evidence.map((item) => item.evidenceId) }));
  const historyClaims = [
    ...(input.history.sameExceptionCount ? [{ key: "sameExceptionCount", value: input.history.sameExceptionCount, statement: `历史记录中同一异常出现 ${input.history.sameExceptionCount} 次。` }] : []),
    ...Object.entries(input.history.actionTypeCounts)
      .filter(([, value]) => value > 0)
      .slice(0, 2)
      .map(([key, value]) => ({ key: `actionTypeCounts.${key}`, value, statement: `历史记录中该动作出现 ${value} 次。` })),
  ];
  return {
    id: actionType,
    actionType,
    title,
    actionSummary: summary,
    rationale,
    evidenceIds: [...new Set(input.evidence.map((item) => item.evidenceId))],
    supportingFacts: [...observed, ...metrics].slice(0, 2),
    historyClaims,
    assumptions: ["Historical counts are descriptive records only."],
    missingEvidence: actionType === "supplement_evidence" ? ["独立签收或核验材料。"] : [],
  };
}

export class DeterministicDecisionRecommendationProvider implements DecisionRecommendationProvider {
  readonly name = "decision-deterministic-demo";
  readonly model = "decision-fixture-v1";

  async generate(request: { input: DecisionRecommendationInput }): Promise<DecisionRecommendationOutput> {
    const input = request.input;
    const eligible = new Set(input.eligibleActions.filter((item) => item.eligible).map((item) => item.actionType));
    const options: DecisionOption[] = [];
    if (input.exception.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH") {
      if (eligible.has("supplement_evidence")) options.push(option(input, "supplement_evidence", "补充签收核验材料", "补充核对物流签收单、POD 或客户确认记录，确认实际签收数量。", "当前记录只能确认差异，不能确认实际签收。"));
      if (eligible.has("create_task")) options.push(option(input, "create_task", "创建人工核验任务", "创建人工任务，跟进物流与客户记录。", "需要人工完成跨系统核验。"));
    } else if (input.exception.code === "PAYMENT_BALANCE_OUTSTANDING") {
      if (eligible.has("urge_follow_up")) options.push(option(input, "urge_follow_up", "跟进未结清款项", "跟进应收余额和后续回款记录。", "当前应收与已记录回款存在差额。"));
      if (eligible.has("create_task")) options.push(option(input, "create_task", "创建回款跟进任务", "创建人工任务持续跟踪资金状态。", "资金状态需要人工确认。"));
    } else {
      if (eligible.has("create_task")) options.push(option(input, "create_task", "创建人工复核任务", "创建人工任务复核当前异常。", "下一步需要人工确认。"));
      if (eligible.has("supplement_evidence")) options.push(option(input, "supplement_evidence", "补充核验材料", "补充与当前异常直接相关的核验材料。", "当前证据可能需要补充。"));
    }
    if (!options.length) throw new Error("decision_no_eligible_options");
    return {
      executiveSummary: "当前事实支持若干下一步人工治理选项，最终决定仍需人工确认。",
      recommendedOptionId: options[0]!.id,
      options: options.slice(0, 3),
      uncertainties: ["历史记录不代表方案有效性或成功率。"],
      humanDecisionRequired: true,
      prohibitedConclusions: ["不得判断根因或责任。", "不得自动审批或执行。"],
    };
  }
}
