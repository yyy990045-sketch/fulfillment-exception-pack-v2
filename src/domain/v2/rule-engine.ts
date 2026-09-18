import { createHash } from "node:crypto";
import type {
  RuleDefinition,
  RuleEvaluation,
  RuleEvaluationStatus,
  RuleExecutionResult,
  RuleVersion,
  FactObservation,
  FactSelector,
  NumericComparisonOperator,
} from "./rule-types.js";
import type { V2SqliteStore } from "./sqlite-store.js";
import type { V2Evidence } from "./types.js";

type FulfillmentReplay = ReturnType<V2SqliteStore["replayContext"]>;

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function ruleVersionContentHash(config: RuleVersion["config"]) {
  return hash(config);
}

function latestEvidence(evidence: V2Evidence[]) {
  const sorted = [...evidence].sort((left, right) =>
    right.observedAt.localeCompare(left.observedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id),
  );
  const latest = sorted[0];
  if (!latest) return [];
  return sorted.filter((item) => item.observedAt === latest.observedAt && item.createdAt === latest.createdAt);
}

export function resolveFactObservation(replay: FulfillmentReplay, selector: FactSelector): FactObservation {
  const entities = replay.entities.filter((entity) => entity.entityType === selector.entityType);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const candidates = replay.evidence.filter((evidence) =>
    evidence.entityId &&
    entityIds.has(evidence.entityId) &&
    evidence.field === selector.field,
  );
  const supported = candidates.filter((evidence) =>
    evidence.support === "supported" &&
    evidence.valueType === selector.valueType &&
    typeof evidence.value === "number" &&
    Number.isFinite(evidence.value),
  );
  const base = {
    selectorKey: selector.key,
    entityIds: [...entityIds],
    candidateEvidenceIds: candidates.map((item) => item.id),
  };

  if (!supported.length) {
    return {
      ...base,
      status: candidates.length ? "invalid" : "missing",
      value: null,
      evidenceIds: [],
      sourceSystemIds: [],
      observedAt: null,
    };
  }

  const byEntity = new Map<string, V2Evidence[]>();
  for (const evidence of supported) {
    const entityId = evidence.entityId!;
    byEntity.set(entityId, [...(byEntity.get(entityId) ?? []), evidence]);
  }
  if (selector.aggregation === "single_latest" && byEntity.size > 1) {
    return {
      ...base,
      status: "ambiguous",
      value: null,
      evidenceIds: supported.map((item) => item.id),
      sourceSystemIds: [...new Set(supported.map((item) => item.sourceSystemId))],
      observedAt: null,
    };
  }

  const selected: V2Evidence[] = [];
  for (const evidence of byEntity.values()) {
    const latest = latestEvidence(evidence);
    const values = new Set(latest.map((item) => item.value as number));
    if (values.size > 1) {
      return {
        ...base,
        status: "ambiguous",
        value: null,
        evidenceIds: supported.map((item) => item.id),
        sourceSystemIds: [...new Set(supported.map((item) => item.sourceSystemId))],
        observedAt: null,
      };
    }
    selected.push(latest[0]!);
  }

  return {
    ...base,
    status: "resolved",
    value: selected.reduce((sum, item) => sum + (item.value as number), 0),
    evidenceIds: selected.map((item) => item.id),
    sourceSystemIds: [...new Set(selected.map((item) => item.sourceSystemId))],
    observedAt: selected.map((item) => item.observedAt).sort().at(-1) ?? null,
  };
}

function compare(operator: NumericComparisonOperator, actual: number, expected: number) {
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "gt") return actual > expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "eq") return actual === expected;
  return actual !== expected;
}

function evaluationStatus(observations: FactObservation[]): RuleEvaluationStatus {
  if (observations.some((item) => item.status === "missing")) return "insufficient_evidence";
  if (observations.some((item) => item.status === "ambiguous")) return "ambiguous_evidence";
  if (observations.some((item) => item.status === "invalid")) return "invalid";
  return "not_matched";
}

export function evaluateRule(
  replay: FulfillmentReplay,
  definition: RuleDefinition,
  version: RuleVersion,
): RuleExecutionResult {
  if (!replay.context) throw new Error("DOMAIN_CONTEXT_NOT_FOUND");
  if (!definition.enabled || version.status !== "active") throw new Error("DOMAIN_RULE_VERSION_NOT_ACTIVE");
  if (definition.id !== version.ruleId || definition.tenantId !== version.tenantId || definition.tenantId !== replay.context.tenantId) {
    throw new Error("DOMAIN_RULE_TENANT_MISMATCH");
  }

  const expected = resolveFactObservation(replay, version.config.expected);
  const actual = resolveFactObservation(replay, version.config.actual);
  const observations = { [expected.selectorKey]: expected, [actual.selectorKey]: actual };
  const baseStatus = evaluationStatus([expected, actual]);
  const matched = baseStatus === "not_matched" && compare(version.config.condition.operator, actual.value!, expected.value!);
  const status = matched ? "matched" : baseStatus;
  const inputHash = hash({ contextId: replay.context.id, definition: definition.code, version: version.id, observations, config: version.config });
  const evaluationId = `eval-${hash({ contextId: replay.context.id, ruleVersionId: version.id, inputHash }).slice(0, 24)}`;
  const metrics: Record<string, number> = {};
  if (expected.value != null && actual.value != null) {
    metrics.expected = expected.value;
    metrics.actual = actual.value;
    metrics.difference = Math.abs(expected.value - actual.value);
  }
  const evaluation: RuleEvaluation = {
    id: evaluationId,
    tenantId: replay.context.tenantId,
    contextId: replay.context.id,
    ruleId: definition.id,
    ruleVersionId: version.id,
    status,
    observations,
    metrics,
    inputHash,
    matchKey: evaluationId,
    evaluatedAt: new Date().toISOString(),
    metadata: {},
  };
  if (status !== "matched") return { evaluation };

  const exceptionId = `exc-${hash({ contextId: replay.context.id, exceptionType: definition.exceptionType, inputHash }).slice(0, 24)}`;
  const evidenceIds = [...new Set([...expected.evidenceIds, ...actual.evidenceIds])];
  const entityIds = [...new Set([...expected.entityIds, ...actual.entityIds])];
  const exception = {
    id: exceptionId,
    tenantId: replay.context.tenantId,
    contextId: replay.context.id,
    ruleId: definition.id,
    ruleVersionId: version.id,
    ruleEvaluationId: evaluation.id,
    code: definition.exceptionType,
    status: "open" as const,
    entityIds,
    evidenceIds,
    matchKey: evaluation.matchKey,
    createdAt: evaluation.evaluatedAt,
    metadata: {},
  };
  const evidence = replay.evidence.filter((item) => evidenceIds.includes(item.id));
  const sourceDocumentIds = new Set(evidence.map((item) => item.sourceDocumentId));
  const sourceSystemIds = new Set(evidence.map((item) => item.sourceSystemId));
  return {
    evaluation,
    exception,
    evidenceBundle: {
      id: `bundle-${hash({ exceptionId, evidenceIds }).slice(0, 24)}`,
      tenantId: replay.context.tenantId,
      contextId: replay.context.id,
      exceptionId,
      observations,
      evidenceIds,
      evidence,
      sourceDocuments: replay.documents.filter((item) => sourceDocumentIds.has(item.id)),
      sourceSystems: replay.sourceSystems.filter((item) => sourceSystemIds.has(item.id)),
    },
  };
}

export function evaluateActiveRules(
  replay: FulfillmentReplay,
  definitions: RuleDefinition[],
  versions: RuleVersion[],
) {
  const definitionById = new Map(definitions.filter((definition) => definition.enabled).map((definition) => [definition.id, definition]));
  return versions
    .filter((version) => version.status === "active" && definitionById.has(version.ruleId))
    .sort((left, right) => {
      const leftOrder = Number(definitionById.get(left.ruleId)?.metadata.order ?? 999);
      const rightOrder = Number(definitionById.get(right.ruleId)?.metadata.order ?? 999);
      return leftOrder - rightOrder || left.ruleId.localeCompare(right.ruleId) || left.version.localeCompare(right.version);
    })
    .map((version) => evaluateRule(replay, definitionById.get(version.ruleId)!, version));
}
