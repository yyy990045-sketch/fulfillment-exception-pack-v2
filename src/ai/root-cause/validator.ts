import {
  RootCauseAiError,
  type RootCauseHypothesis,
  type RootCauseInput,
  type RootCauseOutput,
  type RootCauseValidation,
} from "./types.js";

const TOP_KEYS = new Set(["summary", "hypotheses", "uncertainties", "humanVerificationRequired", "prohibitedConclusions"]);
const HYPOTHESIS_KEYS = new Set(["id", "statement", "epistemicStatus", "supportingEvidenceIds", "contradictingEvidenceIds", "missingEvidence", "verificationSteps"]);
const HIDDEN_KEYS = new Set(["chainOfThought", "reasoning", "internalReasoning", "scratchpad"]);
const CERTAINTY_PATTERNS = [
  /根因是/,
  /已经证明/,
  /确定由/,
  /必然导致/,
  /就是因为/,
  /确认根因/,
  /\bconfirmed cause\b/i,
  /\broot cause is\b/i,
  /\bdefinitely caused\b/i,
];
const RESPONSIBILITY_PATTERNS = [
  /仓库责任/,
  /客户责任/,
  /物流责任/,
  /质量部门责任/,
  /赔偿责任/,
  /违约责任/,
  /责任在/,
  /应由[^。；，]*(?:负责|承担)/,
  /\bliable\b/i,
  /\bliability\b/i,
  /\bresponsib(?:le|ility)\b/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>, path: string) {
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) throw new RootCauseAiError(`ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:${path}.${extra}`, 502);
}

function assertNoHidden(value: unknown, path = "output") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoHidden(item, `${path}[${index}]`));
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key)) throw new RootCauseAiError(`ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:${path}.${key}`, 502);
    assertNoHidden(nested, `${path}.${key}`);
  }
}

function stringValue(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim()) throw new RootCauseAiError(`ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:${path}`, 502);
  return value;
}

function stringArray(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new RootCauseAiError(`ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:${path}`, 502);
  }
  return value as string[];
}

export function parseRootCauseOutput(raw: unknown): RootCauseOutput {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:json", 502); }
  }
  assertNoHidden(value);
  if (!isRecord(value)) throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:root", 502);
  onlyKeys(value, TOP_KEYS, "output");
  if (!Array.isArray(value.hypotheses) || value.hypotheses.length < 1 || value.hypotheses.length > 3) {
    throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:hypotheses", 502);
  }
  const hypotheses = value.hypotheses.map((item, index) => {
    if (!isRecord(item)) throw new RootCauseAiError(`ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:hypotheses[${index}]`, 502);
    onlyKeys(item, HYPOTHESIS_KEYS, `hypotheses[${index}]`);
    if (item.epistemicStatus !== "hypothesis") {
      throw new RootCauseAiError(`ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:hypotheses[${index}].epistemicStatus`, 502);
    }
    return {
      id: stringValue(item.id, `hypotheses[${index}].id`),
      statement: stringValue(item.statement, `hypotheses[${index}].statement`),
      epistemicStatus: "hypothesis" as const,
      supportingEvidenceIds: stringArray(item.supportingEvidenceIds, `hypotheses[${index}].supportingEvidenceIds`),
      contradictingEvidenceIds: stringArray(item.contradictingEvidenceIds, `hypotheses[${index}].contradictingEvidenceIds`),
      missingEvidence: stringArray(item.missingEvidence, `hypotheses[${index}].missingEvidence`),
      verificationSteps: stringArray(item.verificationSteps, `hypotheses[${index}].verificationSteps`),
    } satisfies RootCauseHypothesis;
  });
  if (value.humanVerificationRequired !== true) {
    throw new RootCauseAiError("ROOT_CAUSE_PROVIDER_INVALID_OUTPUT:humanVerificationRequired", 502);
  }
  return {
    summary: stringValue(value.summary, "summary"),
    hypotheses,
    uncertainties: stringArray(value.uncertainties, "uncertainties"),
    humanVerificationRequired: true,
    prohibitedConclusions: stringArray(value.prohibitedConclusions, "prohibitedConclusions"),
  };
}

function numbers(text: string) {
  return [...text.matchAll(/(?<![A-Za-z0-9-])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9-])/g)].map((match) => Number(match[1]));
}

function unsupported(text: string) {
  return CERTAINTY_PATTERNS.some((pattern) => pattern.test(text))
    || RESPONSIBILITY_PATTERNS.some((pattern) => pattern.test(text));
}

function allowedNumbers(input: RootCauseInput) {
  const values = new Set<number>([
    ...Object.values(input.evaluation.observations).flatMap((item) => typeof item.value === "number" ? [item.value] : []),
    ...Object.values(input.evaluation.metrics),
    ...Object.values(input.exception.metrics),
    ...input.evidence.flatMap((item) => typeof item.value === "number" ? [item.value] : []),
    ...input.contextFacts.flatMap((item) => Object.values(item.attributes).filter((value): value is number => typeof value === "number")),
  ]);
  return values;
}

export function validateRootCauseOutput(
  input: RootCauseInput,
  output: RootCauseOutput,
  now: () => Date = () => new Date(),
): RootCauseValidation {
  const citationErrors: string[] = [];
  const numericErrors: string[] = [];
  const unsupportedClaims: string[] = [];
  const schemaErrors: string[] = [];
  const evidenceIds = new Set(input.evidence.map((item) => item.evidenceId));
  const allowed = allowedNumbers(input);
  const checkCitation = (path: string, id: string) => {
    if (!evidenceIds.has(id)) citationErrors.push(`${path}:${id}`);
  };
  const checkText = (path: string, text: string) => {
    if (unsupported(text)) unsupportedClaims.push(`${path}:unsupported_claim`);
    for (const number of numbers(text)) if (!allowed.has(number)) numericErrors.push(`${path}:${number}`);
  };

  if (new Set(output.hypotheses.map((item) => item.id)).size !== output.hypotheses.length) schemaErrors.push("duplicate_hypothesis_id");
  checkText("summary", output.summary);
  output.hypotheses.forEach((hypothesis, index) => {
    const path = `hypotheses[${index}]`;
    if (!hypothesis.supportingEvidenceIds.length) citationErrors.push(`${path}:supporting_citation_required`);
    for (const id of hypothesis.supportingEvidenceIds) checkCitation(`${path}.supporting`, id);
    for (const id of hypothesis.contradictingEvidenceIds) checkCitation(`${path}.contradicting`, id);
    checkText(`${path}.statement`, hypothesis.statement);
    hypothesis.missingEvidence.forEach((item, itemIndex) => checkText(`${path}.missingEvidence[${itemIndex}]`, item));
    hypothesis.verificationSteps.forEach((item, itemIndex) => checkText(`${path}.verificationSteps[${itemIndex}]`, item));
  });
  output.uncertainties.forEach((item, index) => checkText(`uncertainties[${index}]`, item));

  return {
    valid: citationErrors.length === 0 && numericErrors.length === 0 && unsupportedClaims.length === 0 && schemaErrors.length === 0,
    citationErrors,
    numericErrors,
    unsupportedClaims,
    schemaErrors,
    validatedAt: now().toISOString(),
  };
}
