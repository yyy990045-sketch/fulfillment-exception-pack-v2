import type { V2SqliteStore } from "../../domain/v2/index.js";
import { getOutcomeEvaluation } from "../../outcomes/service.js";
import { presentSupportedActions } from "./bindings.js";
import { requireInstalledPackForContext } from "./resolver.js";

function latestEvidence(store: V2SqliteStore, tenantId: string, contextId: string, entityId: string, field: string) {
  return store.listEvidence(tenantId, contextId)
    .filter((item) => item.entityId === entityId && item.field === field && item.support === "supported")
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id))[0];
}

export function buildPackWorkbenchView(store: V2SqliteStore, tenantId: string, contextId: string) {
  const replay = store.replayContext(tenantId, contextId);
  if (!replay.context) return undefined;
  const pack = requireInstalledPackForContext(store, replay.context);
  const evaluations = store.listRuleEvaluations(tenantId, contextId);
  const exceptions = store.listExceptions(tenantId, contextId);
  const exceptionEntityIds = new Set(exceptions.flatMap((item) => item.entityIds));
  const syntheticDemoData = replay.context.metadata.synthetic === true
    || replay.evidence.some((item) => item.metadata.synthetic === true);
  const thread = pack.presentation.stages.flatMap((stage) => {
    const entity = replay.entities.find((item) => item.entityType === stage.entityType);
    if (!entity) return [];
    const facts = stage.factSelectors.flatMap((selector) => {
      const evidence = latestEvidence(store, tenantId, contextId, entity.id, selector.field);
      return evidence ? [{
        key: selector.key,
        label: selector.label,
        field: selector.field,
        value: evidence.value,
        valueType: evidence.valueType,
        evidenceId: evidence.id,
      }] : [];
    });
    return [{
      key: stage.key,
      label: stage.label,
      entityId: entity.id,
      businessKey: entity.businessKey,
      facts,
      state: exceptionEntityIds.has(entity.id) ? "exception" as const : "normal" as const,
    }];
  });
  return {
    pack: {
      id: pack.manifest.id,
      version: pack.manifest.version,
      name: pack.manifest.name,
      contextLabel: pack.presentation.contextLabel,
      workbenchPath: pack.manifest.workbenchPath ?? `/workspace?context=${encodeURIComponent(contextId)}`,
      supportedActions: presentSupportedActions(pack),
    },
    context: replay.context,
    stats: {
      entities: replay.entities.length,
      evidence: replay.evidence.length,
      ruleEvaluations: evaluations.length,
      matchedRules: evaluations.filter((item) => item.status === "matched").length,
      notMatchedRules: evaluations.filter((item) => item.status === "not_matched").length,
      exceptions: exceptions.length,
    },
    thread,
    rules: evaluations.map((evaluation) => {
      const definition = store.getRuleDefinition(tenantId, evaluation.ruleId);
      const code = definition?.code ?? evaluation.ruleId;
      return {
        id: evaluation.id,
        code,
        label: pack.presentation.ruleLabels[code] ?? definition?.name ?? code,
        status: evaluation.status,
        matched: evaluation.status === "matched",
        metrics: evaluation.metrics,
      };
    }),
    exceptions: exceptions.map((exception) => ({
      id: exception.id,
      code: exception.code,
      label: pack.presentation.exceptionLabels[exception.code] ?? exception.title,
      title: exception.title,
      summary: exception.summary,
      severity: exception.severity,
      metrics: exception.metrics,
      evidenceCount: store.getExceptionEvidenceBundle(tenantId, exception.id)?.evidence.length ?? 0,
    })),
    outcomes: replay.context
      ? exceptions.flatMap((exception) => store.listOutcomeEvaluations(tenantId, contextId, exception.id)
        .flatMap((item) => {
          const view = getOutcomeEvaluation(store, tenantId, contextId, exception.id, item.id);
          return view ? [view] : [];
        }))
      : [],
    truthfulness: {
      syntheticDemoData,
      packBound: true,
      causalAttribution: false,
    },
  };
}
