import type { FulfillmentExceptionCode, V2Exception, RuleEvaluation } from "./rule-types.js";
import type { V2SqliteStore } from "./sqlite-store.js";
import { evaluateActiveRules } from "./rule-engine.js";
import { DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS } from "./rules/so-demo-001-rules.js";

export type { FulfillmentExceptionCode } from "./rule-types.js";

export type FulfillmentException = {
  id: string;
  tenantId: string;
  contextId: string;
  code: FulfillmentExceptionCode;
  ruleId: string;
  entityIds: string[];
  evidenceIds: string[];
  leftValue: number;
  rightValue: number;
  difference: number;
};

type FulfillmentReplay = ReturnType<V2SqliteStore["replayContext"]>;

function compatibilityException(exception: V2Exception, evaluation: RuleEvaluation): FulfillmentException {
  return {
    id: exception.id,
    tenantId: exception.tenantId,
    contextId: exception.contextId,
    code: exception.code,
    ruleId: exception.ruleId,
    entityIds: exception.entityIds,
    evidenceIds: exception.evidenceIds,
    leftValue: evaluation.metrics.expected!,
    rightValue: evaluation.metrics.actual!,
    difference: evaluation.metrics.difference!,
  };
}

export function evaluateFulfillmentExceptions(replay: FulfillmentReplay): FulfillmentException[] {
  return evaluateActiveRules(replay, DEMO_RULE_DEFINITIONS, DEMO_RULE_VERSIONS)
    .filter((result): result is typeof result & { exception: V2Exception } => Boolean(result.exception))
    .map((result) => compatibilityException(result.exception, result.evaluation));
}
