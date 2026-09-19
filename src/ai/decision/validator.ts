import type { ActionType } from "../../types.js";
import { DecisionAiError, type DecisionRecommendationInput, type DecisionRecommendationOutput, type DecisionRecommendationValidation } from "./types.js";

const OPTION_KEYS = new Set(["id", "actionType", "title", "actionSummary", "rationale", "evidenceIds", "supportingFacts", "historyClaims", "assumptions", "missingEvidence"]);
const FACT_KEYS = new Set(["kind", "key", "value", "evidenceIds"]);
const HISTORY_KEYS = new Set(["key", "value", "statement"]);
const HIDDEN_KEYS = new Set(["chainOfThought", "reasoning", "internalReasoning", "scratchpad"]);
const ACTIONS = new Set<ActionType>(["supplement_evidence", "urge_follow_up", "reject_overclaim", "review_quotation", "create_task"]);
const OUTCOME_PATTERNS = [/成功率/, /最佳实践/, /最有效/, /历史证明有效/, /通常能解决/, /最优方案/];
const CAUSAL_PATTERNS = [/导致/, /造成/, /因为/, /由于/, /根因/, /责任/, /负责/, /违约/, /赔偿/, /客户实际收到[^。；，]*\d+/];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>, path: string) {
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:${path}.${extra}`, 502);
}

function stringValue(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim()) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:${path}`, 502);
  return value;
}

function stringArray(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:${path}`, 502);
  return value as string[];
}

function evidenceIds(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:${path}`, 502);
  return value as string[];
}

function scalar(value: unknown, path: string) {
  if (typeof value !== "string" && typeof value !== "number") throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:${path}`, 502);
  return value;
}

function assertNoHidden(value: unknown, path = "output") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoHidden(item, `${path}[${index}]`));
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key)) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:${path}.${key}`, 502);
    assertNoHidden(nested, `${path}.${key}`);
  }
}

export function parseDecisionRecommendationOutput(raw: unknown): DecisionRecommendationOutput {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT:json", 502); }
  }
  assertNoHidden(value);
  if (!isRecord(value)) throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT:root", 502);
  const topKeys = new Set(["executiveSummary", "recommendedOptionId", "options", "uncertainties", "humanDecisionRequired", "prohibitedConclusions"]);
  onlyKeys(value, topKeys, "output");
  if (!Array.isArray(value.options) || value.options.length < 1 || value.options.length > 3) throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT:options", 502);
  const options = value.options.map((item, index) => {
    if (!isRecord(item)) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:options[${index}]`, 502);
    onlyKeys(item, OPTION_KEYS, `options[${index}]`);
    const actionType = stringValue(item.actionType, `options[${index}].actionType`) as ActionType;
    if (!ACTIONS.has(actionType)) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:options[${index}].actionType`, 502);
    if (!Array.isArray(item.supportingFacts)) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:options[${index}].supportingFacts`, 502);
    if (!Array.isArray(item.historyClaims)) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:options[${index}].historyClaims`, 502);
    const supportingFacts = item.supportingFacts.map((fact, factIndex) => {
      if (!isRecord(fact)) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:options[${index}].supportingFacts[${factIndex}]`, 502);
      onlyKeys(fact, FACT_KEYS, `options[${index}].supportingFacts[${factIndex}]`);
      const kind = stringValue(fact.kind, `options[${index}].supportingFacts[${factIndex}].kind`);
      if (!["expected", "actual", "metric", "source_fact"].includes(kind)) throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT:kind", 502);
      return { kind: kind as "expected" | "actual" | "metric" | "source_fact", key: stringValue(fact.key, "fact.key"), value: scalar(fact.value, "fact.value"), evidenceIds: evidenceIds(fact.evidenceIds, "fact.evidenceIds") };
    });
    const historyClaims = item.historyClaims.map((claim, claimIndex) => {
      if (!isRecord(claim)) throw new DecisionAiError(`DECISION_PROVIDER_INVALID_OUTPUT:options[${index}].historyClaims[${claimIndex}]`, 502);
      onlyKeys(claim, HISTORY_KEYS, "historyClaim");
      return { key: stringValue(claim.key, "historyClaim.key"), value: scalar(claim.value, "historyClaim.value"), statement: stringValue(claim.statement, "historyClaim.statement") };
    });
    return {
      id: stringValue(item.id, `options[${index}].id`),
      actionType,
      title: stringValue(item.title, `options[${index}].title`),
      actionSummary: stringValue(item.actionSummary, `options[${index}].actionSummary`),
      rationale: stringValue(item.rationale, `options[${index}].rationale`),
      evidenceIds: evidenceIds(item.evidenceIds, `options[${index}].evidenceIds`),
      supportingFacts,
      historyClaims,
      assumptions: stringArray(item.assumptions, `options[${index}].assumptions`),
      missingEvidence: stringArray(item.missingEvidence, `options[${index}].missingEvidence`),
    };
  });
  if (value.humanDecisionRequired !== true) throw new DecisionAiError("DECISION_PROVIDER_INVALID_OUTPUT:humanDecisionRequired", 502);
  return {
    executiveSummary: stringValue(value.executiveSummary, "executiveSummary"),
    recommendedOptionId: stringValue(value.recommendedOptionId, "recommendedOptionId"),
    options,
    uncertainties: stringArray(value.uncertainties, "uncertainties"),
    humanDecisionRequired: true,
    prohibitedConclusions: stringArray(value.prohibitedConclusions, "prohibitedConclusions"),
  };
}

function numbers(text: string) {
  return [...text.matchAll(/(?<![A-Za-z0-9-])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9-])/g)].map((match) => Number(match[1]));
}

function unsupported(text: string) {
  return OUTCOME_PATTERNS.some((pattern) => pattern.test(text)) || CAUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

function historyValue(input: DecisionRecommendationInput, key: string): string | number | undefined {
  if (key === "sameExceptionCount") return input.history.sameExceptionCount;
  if (key === "sameExceptionWithResolutionCount") return input.history.sameExceptionWithResolutionCount;
  if (key === "closedResolutionCaseCount") return input.history.closedResolutionCaseCount;
  if (key === "rejectedResolutionCaseCount") return input.history.rejectedResolutionCaseCount;
  if (key.startsWith("actionTypeCounts.")) return input.history.actionTypeCounts[key.slice("actionTypeCounts.".length) as ActionType];
  if (key.startsWith("resolutionStatusCounts.")) return input.history.resolutionStatusCounts[key.slice("resolutionStatusCounts.".length)];
  return undefined;
}

export function validateDecisionRecommendation(
  input: DecisionRecommendationInput,
  output: DecisionRecommendationOutput,
): DecisionRecommendationValidation {
  const citationErrors: string[] = [];
  const numericErrors: string[] = [];
  const historyErrors: string[] = [];
  const eligibilityErrors: string[] = [];
  const unsupportedClaims: string[] = [];
  const schemaErrors: string[] = [];
  const evidenceIdsSet = new Set(input.evidence.map((item) => item.evidenceId));
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  const allowedNumbers = new Set<number>([
    ...Object.values(input.evaluation.observations).flatMap((item) => typeof item.value === "number" ? [item.value] : []),
    ...Object.values(input.evaluation.metrics),
    ...Object.values(input.exception.metrics),
    ...input.contextFacts.flatMap((fact) => Object.values(fact.attributes).filter((value): value is number => typeof value === "number")),
    ...input.evidence.flatMap((item) => typeof item.value === "number" ? [item.value] : []),
  ]);

  if (!output.options.some((option) => option.id === output.recommendedOptionId)) schemaErrors.push("recommended_option_missing");
  if (new Set(output.options.map((option) => option.id)).size !== output.options.length) schemaErrors.push("duplicate_option_id");
  output.options.forEach((option, index) => {
    const path = `options[${index}]`;
    for (const id of option.evidenceIds) if (!evidenceIdsSet.has(id)) citationErrors.push(`${path}:${id}`);
    if (!option.evidenceIds.length) citationErrors.push(`${path}:citation_required`);
    for (const fact of option.supportingFacts) {
      for (const id of fact.evidenceIds) if (!evidenceIdsSet.has(id)) citationErrors.push(`${path}.${fact.key}:${id}`);
      if (fact.kind === "expected" || fact.kind === "actual") {
        const observation = input.evaluation.observations[fact.key];
        if (!observation || observation.status !== "resolved" || observation.value !== fact.value) numericErrors.push(`${path}.${fact.key}:observation`);
      } else if (fact.kind === "metric") {
        if (input.evaluation.metrics[fact.key] !== fact.value) numericErrors.push(`${path}.${fact.key}:metric`);
      } else {
        const matches = fact.evidenceIds.flatMap((id) => evidenceById.get(id) ?? []).some((item) => item.field === fact.key && item.value === fact.value);
        if (!matches) numericErrors.push(`${path}.${fact.key}:source_fact`);
      }
    }
    for (const claim of option.historyClaims) {
      const actual = historyValue(input, claim.key);
      if (actual === undefined || actual !== claim.value) historyErrors.push(`${path}.${claim.key}`);
      if (typeof claim.value === "number" && numbers(claim.statement).some((number) => number !== claim.value)) historyErrors.push(`${path}.${claim.key}:statement`);
    }
    const eligibility = input.eligibleActions.find((item) => item.actionType === option.actionType);
    if (!eligibility?.eligible) eligibilityErrors.push(`${path}:${option.actionType}`);
    if ([option.title, option.actionSummary, option.rationale, ...option.assumptions, ...option.missingEvidence, ...option.historyClaims.map((claim) => claim.statement)].some(unsupported)) unsupportedClaims.push(`${path}:unsupported_claim`);
    if (option.supportingFacts.some((fact) => numbers(String(fact.value)).some((number) => !allowedNumbers.has(number)))) numericErrors.push(`${path}:ungrounded_number`);
    if ([...option.assumptions, ...option.missingEvidence].some((text) => numbers(text).some((number) => !allowedNumbers.has(number)))) numericErrors.push(`${path}:ungrounded_text_number`);
  });
  if (unsupported(output.executiveSummary)) unsupportedClaims.push("executiveSummary:unsupported_claim");
  for (const number of numbers(output.executiveSummary)) if (!allowedNumbers.has(number)) numericErrors.push(`executiveSummary:${number}`);
  const negated = /(不代表|不表示|不构成|无法判断|不能判断|尚未|并非|不是)/;
  if (output.uncertainties.some((text) => !negated.test(text) && unsupported(text))) unsupportedClaims.push("uncertainties:unsupported_claim");
  for (const text of output.uncertainties) {
    for (const number of numbers(text)) if (!allowedNumbers.has(number)) numericErrors.push(`uncertainties:${number}`);
  }
  return {
    valid: !citationErrors.length && !numericErrors.length && !historyErrors.length && !eligibilityErrors.length && !unsupportedClaims.length && !schemaErrors.length,
    citationErrors,
    numericErrors,
    historyErrors,
    eligibilityErrors,
    unsupportedClaims,
    schemaErrors,
    validatedAt: new Date().toISOString(),
  };
}
