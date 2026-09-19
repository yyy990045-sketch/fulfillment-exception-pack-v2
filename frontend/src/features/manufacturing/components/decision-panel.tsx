import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { cn } from "../../../lib/utils.js";
import type { DecisionRecommendationView } from "../analysis-types.js";
import type { EvidenceBundleView } from "../types.js";
import { actionTypeLabel } from "../utils.js";
import { EvidenceReferenceList } from "./citation-list.js";

export function DecisionPanel({
  recommendation,
  selectedOptionId,
  onSelectOption,
  evidence,
  onOpenEvidence,
}: {
  recommendation: DecisionRecommendationView;
  selectedOptionId?: string;
  onSelectOption: (optionId: string) => void;
  evidence: EvidenceBundleView | undefined;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const stale = recommendation.stale;
  return (
    <section aria-labelledby="decision-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="decision-title" className="text-sm font-semibold">决策建议</h2>
          <Badge variant="info">建议不是执行结果</Badge>
          <Badge variant={recommendation.output.humanDecisionRequired ? "warning" : "danger"}>
            {recommendation.output.humanDecisionRequired ? "需要人工决策" : "需要人工复核"}
          </Badge>
          {stale && <Badge variant="warning">基于旧证据快照</Badge>}
        </div>
      </div>
      {stale && (
        <p className="mt-3 border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-warning">
          该建议基于旧证据或旧历史快照，请以当前事实为准。
        </p>
      )}
      <p className="mt-3 text-sm leading-6 text-text-secondary">{recommendation.output.executiveSummary}</p>
      <div className="mt-4 divide-y divide-border border-y border-border">
        {recommendation.output.options.map((option) => {
          const recommended = option.id === recommendation.output.recommendedOptionId;
          const selected = option.id === selectedOptionId;
          return (
            <article
              key={option.id}
              className={cn(
                "border-l-2 border-l-transparent py-4 pl-3",
                selected && "border-l-interactive bg-interactive/5",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={recommended ? "info" : "default"}>{recommended ? "推荐候选" : "备选方案"}</Badge>
                  <Badge>{actionTypeLabel(option.actionType)}</Badge>
                  {selected && <Badge variant="success">已选治理候选</Badge>}
                </div>
                <Button
                  variant={selected ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => onSelectOption(option.id)}
                >
                  {selected ? "已选择" : "用于治理评估"}
                </Button>
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
                  <dd className="mt-1"><EvidenceReferenceList evidenceIds={option.evidenceIds} bundle={evidence} onOpenEvidence={onOpenEvidence} /></dd>
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
    </section>
  );
}
