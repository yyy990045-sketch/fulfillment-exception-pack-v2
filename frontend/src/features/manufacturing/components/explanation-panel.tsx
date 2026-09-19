import { Badge } from "../../../components/ui/badge.js";
import { useGroundedExplanation } from "../../../hooks/use-manufacturing.js";
import type { EvidenceBundleView } from "../types.js";
import { CitationStatementList } from "./citation-list.js";
import { InlineEmpty, InlineError, SectionSkeleton } from "./query-state.js";

export function ExplanationPanel({
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
  const query = useGroundedExplanation(contextId, exceptionId);
  const explanation = query.detail.data?.explanation;
  const stale = query.detail.data?.stale ?? false;
  return (
    <section aria-labelledby="explanation-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="explanation-title" className="text-sm font-semibold">AI 解释</h2>
          {explanation && (
            <Badge variant={explanation.status === "generated" ? "info" : "danger"}>
              {explanation.status === "generated" ? "已生成" : "未通过校验"}
            </Badge>
          )}
          {explanation && stale && <Badge variant="warning">基于旧证据快照</Badge>}
        </div>
      </div>
      {(query.list.isLoading || (query.latest && query.detail.isLoading)) ? <SectionSkeleton /> : null}
      {(!query.list.isLoading && (query.list.isError || query.detail.isError)) ? (
        <div className="mt-3"><InlineError title="AI 解释加载失败" detail="当前解释记录无法读取。" /></div>
      ) : null}
      {!query.list.isLoading && !query.list.isError && !query.detail.isError && !query.latest ? <InlineEmpty /> : null}
      {explanation && stale && (
        <p className="mt-3 border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-warning">
          该解释基于旧证据快照，请以当前 Evidence 为准。
        </p>
      )}
      {explanation && (
        <>
          <p className="mt-3 max-w-[78ch] text-sm leading-6 text-text-secondary">{explanation.output.executiveSummary}</p>
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr_0.9fr]">
            <div>
              <h3 className="text-xs font-semibold text-text-muted">已知事实</h3>
              <div className="mt-2">
                <CitationStatementList items={explanation.output.facts} bundle={evidence} onOpenEvidence={onOpenEvidence} />
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-text-muted">未知信息</h3>
              <div className="mt-2">
                <CitationStatementList items={explanation.output.uncertainties} bundle={evidence} onOpenEvidence={onOpenEvidence} />
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-text-muted">待核实事项</h3>
              {explanation.output.questionsToVerify.length ? (
                <ul className="mt-2 space-y-2">
                  {explanation.output.questionsToVerify.map((question) => (
                    <li key={question} className="border-b border-border pb-2 text-sm text-text-secondary last:border-b-0">
                      {question}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-text-muted">无</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
