import { Badge } from "../../../components/ui/badge.js";
import { useDecisionRecommendation } from "../../../hooks/use-manufacturing.js";
import { EvidenceReferenceList } from "./citation-list.js";
import { InlineEmpty, InlineError, SectionSkeleton } from "./query-state.js";
import { TechnicalMetadataSheet } from "./technical-metadata-sheet.js";

export function DecisionPanel({
  contextId,
  exceptionId,
  onOpenEvidence,
}: {
  contextId: string;
  exceptionId: string;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const query = useDecisionRecommendation(contextId, exceptionId);
  const recommendation = query.detail.data;
  const stale = Boolean(recommendation?.stale || query.latest?.stale);
  return (
    <section aria-labelledby="decision-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="decision-title" className="text-sm font-semibold">处置建议</h2>
          {recommendation && <Badge variant="info">建议不是执行结果</Badge>}
          {recommendation && (
            <Badge variant={recommendation.output.humanDecisionRequired ? "warning" : "danger"}>
              {recommendation.output.humanDecisionRequired ? "需要人工决策" : "需要人工复核"}
            </Badge>
          )}
          {recommendation && stale && <Badge variant="warning">基于旧证据快照</Badge>}
        </div>
        {recommendation && (
          <TechnicalMetadataSheet
            title="处置建议技术信息"
            metadata={[
              { label: "Provider", value: recommendation.provider },
              { label: "Model", value: recommendation.model },
              { label: "Recommendation ID", value: recommendation.id },
              { label: "Snapshot hash", value: recommendation.inputSnapshotHash },
              { label: "Created at", value: recommendation.createdAt },
            ]}
          />
        )}
      </div>
      {(query.list.isLoading || (query.latest && query.detail.isLoading)) ? <SectionSkeleton /> : null}
      {(!query.list.isLoading && (query.list.isError || query.detail.isError)) ? (
        <div className="mt-3"><InlineError title="处置建议加载失败" detail="当前建议记录无法读取。" /></div>
      ) : null}
      {!query.list.isLoading && !query.list.isError && !query.detail.isError && !query.latest ? <InlineEmpty /> : null}
      {recommendation && stale && (
        <p className="mt-3 border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-warning">
          该建议基于旧证据或旧历史快照，请以当前事实为准。
        </p>
      )}
      {recommendation && (
        <>
          <p className="mt-3 text-sm leading-6 text-text-secondary">{recommendation.output.executiveSummary}</p>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {recommendation.output.options.map((option) => {
              const recommended = option.id === recommendation.output.recommendedOptionId;
              return (
                <article key={option.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={recommended ? "info" : "default"}>{recommended ? "推荐候选" : "备选方案"}</Badge>
                    <Badge>{option.actionType}</Badge>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold">{option.title}</h3>
                  <p className="mt-1 text-sm text-text-secondary">{option.actionSummary}</p>
                  <p className="mt-2 text-sm text-text-muted">{option.rationale}</p>
                  <dl className="mt-3 grid gap-3 text-xs xl:grid-cols-2">
                    <div>
                      <dt className="text-text-muted">支持事实</dt>
                      <dd className="mt-1 space-y-1">
                        {option.supportingFacts.map((fact) => (
                          <p key={`${fact.kind}-${fact.key}`}>{fact.key} = {String(fact.value)}</p>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">证据引用</dt>
                      <dd className="mt-1"><EvidenceReferenceList evidenceIds={option.evidenceIds} onOpenEvidence={onOpenEvidence} /></dd>
                    </div>
                  </dl>
                  {option.assumptions.length > 0 && (
                    <p className="mt-3 text-xs text-warning">前提假设：{option.assumptions.join("、")}</p>
                  )}
                  {option.missingEvidence.length > 0 && (
                    <p className="mt-2 text-xs text-warning">缺失材料：{option.missingEvidence.join("、")}</p>
                  )}
                </article>
              );
            })}
          </div>
          {recommendation.output.uncertainties.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-text-muted">尚不确定</h3>
              <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                {recommendation.output.uncertainties.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
