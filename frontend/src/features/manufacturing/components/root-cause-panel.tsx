import { Badge } from "../../../components/ui/badge.js";
import { useRootCauseAnalysis } from "../../../hooks/use-manufacturing.js";
import type { EvidenceBundleView } from "../types.js";
import { EvidenceReferenceList } from "./citation-list.js";
import { InlineEmpty, InlineError, SectionSkeleton } from "./query-state.js";

export function RootCausePanel({
  contextId,
  exceptionId,
  evidence,
  onOpenEvidence,
}: {
  contextId: string;
  exceptionId: string;
  evidence: EvidenceBundleView | undefined;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const query = useRootCauseAnalysis(contextId, exceptionId);
  const analysis = query.detail.data;
  const stale = Boolean(analysis?.stale || query.latest?.stale);
  return (
    <section aria-labelledby="root-cause-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="root-cause-title" className="text-sm font-semibold">根因假设</h2>
          {analysis && <Badge variant="warning">均为待验证假设</Badge>}
          {analysis?.output.humanVerificationRequired && <Badge>需要人工验证</Badge>}
          {analysis && stale && <Badge variant="warning">基于旧证据快照</Badge>}
        </div>
      </div>
      {(query.list.isLoading || (query.latest && query.detail.isLoading)) ? <SectionSkeleton /> : null}
      {(!query.list.isLoading && (query.list.isError || query.detail.isError)) ? (
        <div className="mt-3"><InlineError title="根因假设加载失败" detail="当前分析记录无法读取。" /></div>
      ) : null}
      {!query.list.isLoading && !query.list.isError && !query.detail.isError && !query.latest ? <InlineEmpty /> : null}
      {analysis && stale && (
        <p className="mt-3 border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-warning">
          该分析基于旧证据快照，不能当作已确认事实。
        </p>
      )}
      {analysis && (
        <>
          <p className="mt-3 text-sm leading-6 text-text-secondary">{analysis.output.summary}</p>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {analysis.output.hypotheses.map((hypothesis) => (
              <article key={hypothesis.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">待验证假设</Badge>
                </div>
                <p className="mt-2 text-sm font-medium leading-6">{hypothesis.statement}</p>
                <dl className="mt-3 grid gap-3 text-xs xl:grid-cols-2">
                  <div>
                    <dt className="text-text-muted">支持证据</dt>
                    <dd className="mt-1">
                      <EvidenceReferenceList evidenceIds={hypothesis.supportingEvidenceIds} bundle={evidence} onOpenEvidence={onOpenEvidence} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">反证或矛盾证据</dt>
                    <dd className="mt-1">
                      <EvidenceReferenceList evidenceIds={hypothesis.contradictingEvidenceIds} bundle={evidence} onOpenEvidence={onOpenEvidence} />
                    </dd>
                  </div>
                </dl>
                {hypothesis.missingEvidence.length > 0 && (
                  <p className="mt-3 text-xs text-warning">缺失材料：{hypothesis.missingEvidence.join("、")}</p>
                )}
                {hypothesis.verificationSteps.length > 0 && (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-text-secondary">
                    {hypothesis.verificationSteps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                )}
              </article>
            ))}
          </div>
          {analysis.output.uncertainties.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-text-muted">尚不确定</h3>
              <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                {analysis.output.uncertainties.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
