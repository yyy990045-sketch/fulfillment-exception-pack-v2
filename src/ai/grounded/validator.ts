import { GroundedAiError, type GroundedExplanationInput, type GroundedExplanationOutput, type GroundingValidation } from "./types.js";

const TOP_LEVEL_KEYS = new Set([
  "executiveSummary",
  "facts",
  "discrepancy",
  "uncertainties",
  "questionsToVerify",
  "prohibitedConclusions",
]);
const FACT_KEYS = new Set(["kind", "key", "value", "statement", "evidenceIds"]);
const CITATION_KEYS = new Set(["statement", "evidenceIds"]);
const HIDDEN_REASONING_KEYS = new Set(["chainOfThought", "reasoning", "internalReasoning", "scratchpad"]);
const FORBIDDEN_OUTPUT_KEYS = new Set(["score", "riskScore", "responsibility", "liability", "compensationAmount"]);
const FACT_KINDS = new Set(["expected", "actual", "metric", "source_fact"]);
const CAUSAL_PATTERNS = [
  /导致/,
  /因为/,
  /由于/,
  /造成/,
  /引发/,
  /影响(?:最终|实际)/,
  /责任/,
  /归因/,
  /根因/,
  /原因/,
  /来源/,
  /责任人/,
  /责任在/,
  /少发/,
  /录错/,
  /客户实际只收到/,
  /发货数量不足/,
  /应赔偿/,
  /赔偿金额/,
  /内部推理/,
  /推理过程/,
  /先.*再.*/,
  /比较.*认定/,
  /认定/,
  /判断/,
  /思维链/,
  /\bchain[- ]of[- ]thought\b/i,
  /\bchainOfThought\b/,
  /\bscratchpad\b/i,
  /\binternal[\s-]?reasoning\b/i,
  /\b(?:score|scores|scoring|riskScore|liability|liable|responsibility|responsible)\b/i,
  /\bcompensationAmount\b/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, path: string) {
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:${path}.${extra}`);
}

function assertNoForbiddenKeys(value: unknown, path = "output") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (HIDDEN_REASONING_KEYS.has(key) || FORBIDDEN_OUTPUT_KEYS.has(key)) {
      throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:${path}.${key}`);
    }
    assertNoForbiddenKeys(nested, `${path}.${key}`);
  }
}

function stringValue(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim()) throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:${path}`);
  return value;
}

function valueValue(value: unknown, path: string) {
  if (typeof value !== "string" && typeof value !== "number") throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:${path}`);
  return value;
}

function evidenceIdsValue(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:${path}`);
  }
  return value as string[];
}

function citationValue(value: unknown, path: string) {
  if (!isRecord(value)) throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:${path}`);
  assertOnlyKeys(value, CITATION_KEYS, path);
  return {
    statement: stringValue(value.statement, `${path}.statement`),
    evidenceIds: evidenceIdsValue(value.evidenceIds, `${path}.evidenceIds`),
  };
}

function parseJsonIfNeeded(raw: unknown) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT:json");
  }
}

export function parseGroundedExplanationOutput(raw: unknown): GroundedExplanationOutput {
  const value = parseJsonIfNeeded(raw);
  assertNoForbiddenKeys(value);
  if (!isRecord(value)) throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT:root");
  assertOnlyKeys(value, TOP_LEVEL_KEYS, "output");
  if (!Array.isArray(value.facts)) throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT:facts");
  if (!Array.isArray(value.uncertainties)) throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT:uncertainties");
  if (!Array.isArray(value.questionsToVerify) || value.questionsToVerify.some((item) => typeof item !== "string")) {
    throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT:questionsToVerify");
  }
  if (!Array.isArray(value.prohibitedConclusions) || value.prohibitedConclusions.some((item) => typeof item !== "string")) {
    throw new GroundedAiError("AI_PROVIDER_INVALID_OUTPUT:prohibitedConclusions");
  }
  const facts = value.facts.map((item, index) => {
    if (!isRecord(item)) throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:facts[${index}]`);
    assertOnlyKeys(item, FACT_KEYS, `facts[${index}]`);
    const kind = stringValue(item.kind, `facts[${index}].kind`);
    if (!FACT_KINDS.has(kind)) throw new GroundedAiError(`AI_PROVIDER_INVALID_OUTPUT:facts[${index}].kind`);
    return {
      kind: kind as GroundedExplanationOutput["facts"][number]["kind"],
      key: stringValue(item.key, `facts[${index}].key`),
      value: valueValue(item.value, `facts[${index}].value`),
      statement: stringValue(item.statement, `facts[${index}].statement`),
      evidenceIds: evidenceIdsValue(item.evidenceIds, `facts[${index}].evidenceIds`),
    };
  });
  const uncertainties = value.uncertainties.map((item, index) => citationValue(item, `uncertainties[${index}]`));
  return {
    executiveSummary: stringValue(value.executiveSummary, "executiveSummary"),
    facts,
    discrepancy: citationValue(value.discrepancy, "discrepancy"),
    uncertainties,
    questionsToVerify: value.questionsToVerify as string[],
    prohibitedConclusions: value.prohibitedConclusions as string[],
  };
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort();
}

function sameIds(left: string[], right: string[]) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function closeEnough(left: unknown, right: unknown) {
  return typeof left === "number" && typeof right === "number" && Math.abs(left - right) < 1e-9;
}

function extractNumbers(statement: string) {
  return [...statement.matchAll(/(?<![A-Za-z0-9-])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9-])/g)]
    .map((match) => Number(match[1]));
}

function causalClaim(statement: string) {
  return CAUSAL_PATTERNS.some((pattern) => pattern.test(statement));
}

function collectAllowedNumbers(input: GroundedExplanationInput) {
  const allowed = new Set<number>();
  for (const observation of Object.values(input.evaluation.observations)) {
    if (typeof observation.value === "number") allowed.add(observation.value);
  }
  for (const metric of Object.values(input.evaluation.metrics)) allowed.add(metric);
  for (const item of input.evidence) {
    if (typeof item.value === "number") allowed.add(item.value);
  }
  return allowed;
}

export function validateGroundedExplanation(
  input: GroundedExplanationInput,
  output: GroundedExplanationOutput,
  now: () => Date = () => new Date(),
): GroundingValidation {
  const citationErrors: string[] = [];
  const numericErrors: string[] = [];
  const unsupportedClaims: string[] = [];
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  const allowedNumbers = collectAllowedNumbers(input);
  const ruleEvidenceIds = sortedUnique(
    Object.values(input.evaluation.observations).flatMap((observation) => observation.evidenceIds),
  );

  const checkCitations = (path: string, ids: string[]) => {
    for (const id of ids) if (!evidenceById.has(id)) citationErrors.push(`${path}:${id}`);
  };

  output.facts.forEach((fact, index) => {
    const path = `facts[${index}]`;
    if (!fact.evidenceIds.length) citationErrors.push(`${path}:citation_required`);
    checkCitations(path, fact.evidenceIds);
    if (causalClaim(fact.statement)) unsupportedClaims.push(`${path}:causal_or_liability_claim`);
    for (const number of extractNumbers(fact.statement)) {
      if (![...allowedNumbers].some((allowed) => Math.abs(allowed - number) < 1e-9)) numericErrors.push(`${path}:number:${number}`);
    }
    if (fact.kind === "expected" || fact.kind === "actual") {
      const observation = input.evaluation.observations[fact.key];
      if (!observation || observation.status !== "resolved" || !closeEnough(fact.value, observation.value)) {
        numericErrors.push(`${path}:${fact.kind}:${fact.key}`);
      } else if (!sameIds(fact.evidenceIds, observation.evidenceIds)) {
        citationErrors.push(`${path}:observation_citation_mismatch`);
      }
      return;
    }
    if (fact.kind === "metric") {
      if (!closeEnough(fact.value, input.evaluation.metrics[fact.key])) numericErrors.push(`${path}:metric:${fact.key}`);
      return;
    }
    const matchingEvidence = fact.evidenceIds
      .flatMap((id) => evidenceById.get(id) ?? [])
      .filter((item) => item.field === fact.key);
    if (!matchingEvidence.some((item) => typeof fact.value === typeof item.value && String(item.value) === String(fact.value))) {
      numericErrors.push(`${path}:source_fact:${fact.key}`);
    }
  });

  checkCitations("discrepancy", output.discrepancy.evidenceIds);
  const minimumDiscrepancyEvidence = Math.min(2, ruleEvidenceIds.length);
  if (sortedUnique(output.discrepancy.evidenceIds).length < minimumDiscrepancyEvidence) {
    citationErrors.push("discrepancy:insufficient_citations");
  }
  for (const ruleEvidenceId of ruleEvidenceIds) {
    if (!output.discrepancy.evidenceIds.includes(ruleEvidenceId)) citationErrors.push(`discrepancy:missing:${ruleEvidenceId}`);
  }
  if (causalClaim(output.discrepancy.statement)) unsupportedClaims.push("discrepancy:causal_or_liability_claim");
  for (const number of extractNumbers(output.discrepancy.statement)) {
    if (![...allowedNumbers].some((allowed) => Math.abs(allowed - number) < 1e-9)) numericErrors.push(`discrepancy:number:${number}`);
  }

  output.uncertainties.forEach((item, index) => {
    const path = `uncertainties[${index}]`;
    checkCitations(path, item.evidenceIds);
    if (causalClaim(item.statement)) unsupportedClaims.push(`${path}:causal_or_liability_claim`);
    const numbers = extractNumbers(item.statement);
    if (!item.evidenceIds.length && numbers.length) {
      unsupportedClaims.push(`${path}:numeric_without_citation`);
    }
    for (const number of numbers) {
      if (![...allowedNumbers].some((allowed) => Math.abs(allowed - number) < 1e-9)) numericErrors.push(`${path}:number:${number}`);
    }
  });

  if (causalClaim(output.executiveSummary)) unsupportedClaims.push("executiveSummary:causal_or_liability_claim");
  for (const number of extractNumbers(output.executiveSummary)) {
    if (![...allowedNumbers].some((allowed) => Math.abs(allowed - number) < 1e-9)) numericErrors.push(`executiveSummary:number:${number}`);
  }

  return {
    valid: citationErrors.length === 0 && numericErrors.length === 0 && unsupportedClaims.length === 0,
    citationErrors,
    numericErrors,
    unsupportedClaims,
    validatedAt: now().toISOString(),
  };
}
