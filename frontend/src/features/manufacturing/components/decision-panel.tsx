import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { cn } from "../../../lib/utils.js";
import type { DecisionRecommendationView } from "../analysis-types.js";
import type { EvidenceBundleView } from "../types.js";
import { actionTypeDescription, actionTypeLabel, businessFactLabel, formatMetricValue } from "../utils.js";
import { KeyEvidenceSummary } from "./key-evidence-summary.js";

type Option = DecisionRecommendationView["output"]["options"][number];

function OptionContent({
  option,
  selected,
  recommended,
  evidence,
  onOpenEvidence,
}: {
  option: Option;
  selected: boolean;
  recommended: boolean;
  evidence: EvidenceBundleView | undefined;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={recommended ? "info" : "default"}>{recommended ? "推荐方案" : "备选方案"}</Badge>
        <Badge>{actionTypeLabel(option.actionType)}</Badge>
        {selected && <Badge variant="success">当前选择</Badge>}
      </div>
      <p className="mt-1 text-[11px] text-text-muted">{actionTypeDescription(option.actionType)}</p>
      <h3 className={cn("mt-3 font-semibold", recommended ? "text-[17px] leading-6" : "text-[14px]")}>{option.title}</h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium text-text-muted">建议动作</div>
          <p className="mt-1 text-[13px] leading-6 text-text-secondary">{option.actionSummary}</p>
        </div>
        <div>
          <div className="text-[11px] font-medium text-text-muted">为什么</div>
          <p className="mt-1 text-[13px] leading-6 text-text-secondary">{option.rationale}</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-4 text-[12px] lg:grid-cols-2">
        <div>
          <dt className="text-text-muted">关键依据</dt>
          <dd className="mt-1.5 space-y-1">
            {option.supportingFacts.slice(0, 5).map((fact) => (
              <p key={`${fact.kind}-${fact.key}`}>{businessFactLabel(fact.key)} {formatMetricValue(fact.value)}</p>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">关键证据</dt>
          <dd className="mt-1.5">
            <KeyEvidenceSummary
              evidenceIds={option.evidenceIds}
              bundle={evidence}
              limit={recommended ? 5 : 3}
              onOpenEvidence={onOpenEvidence}
              emptyMessage="暂无关键证据"
            />
          </dd>
        </div>
      </dl>
      {(option.assumptions.length > 0 || option.missingEvidence.length > 0) && (
        <div className="mt-3 space-y-1 text-[11px] text-warning">
          {option.assumptions.length > 0 && <p>风险提示：{option.assumptions.join("、")}</p>}
          {option.missingEvidence.length > 0 && <p>待补资料：{option.missingEvidence.join("、")}</p>}
        </div>
      )}
    </>
  );
}

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
  const recommended = recommendation.output.options.find((option) => option.id === recommendation.output.recommendedOptionId)
    ?? recommendation.output.options[0];
  const alternatives = recommendation.output.options.filter((option) => option.id !== recommended?.id);
  return (
    <section aria-labelledby="decision-title" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="decision-title" className="text-[15px] font-semibold">建议处理</h2>
          <Badge variant="info">建议不是执行结果</Badge>
          <Badge variant={recommendation.output.humanDecisionRequired ? "warning" : "danger"}>
            {recommendation.output.humanDecisionRequired ? "需要人工决策" : "需要人工复核"}
          </Badge>
          {recommendation.stale && <Badge variant="warning">基于旧证据快照</Badge>}
        </div>
      </div>
      {recommendation.stale && (
        <p className="border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-warning">
          该建议基于旧证据或旧历史快照，请以当前事实为准。
        </p>
      )}
      <p className="max-w-[78ch] text-[13px] leading-6 text-text-secondary">{recommendation.output.executiveSummary}</p>

      {recommended && (
        <article className={cn(
          "rounded-lg border p-5",
          selectedOptionId === recommended.id
            ? "border-interactive/30 bg-interactive/[0.035]"
            : "border-border/85 bg-surface",
        )}>
          <OptionContent
            option={recommended}
            selected={selectedOptionId === recommended.id}
            recommended
            evidence={evidence}
            onOpenEvidence={onOpenEvidence}
          />
          <div className="mt-4 flex justify-end">
            <Button
              variant={selectedOptionId === recommended.id ? "secondary" : "default"}
              size="sm"
              onClick={() => onSelectOption(recommended.id)}
            >
              {selectedOptionId === recommended.id ? "已选择" : "选择推荐方案"}
            </Button>
          </div>
        </article>
      )}

      {alternatives.length > 0 && (
        <section>
          <h3 className="text-[12px] font-medium text-text-muted">其他候选</h3>
          <div className="mt-2 divide-y divide-border/65 rounded-lg border border-border/80">
            {alternatives.map((option) => (
              <article
                key={option.id}
                className={cn(
                  "p-4 transition-colors",
                  selectedOptionId === option.id ? "bg-interactive/[0.035]" : "bg-surface hover:bg-surface-subtle",
                )}
              >
                <OptionContent
                  option={option}
                  selected={selectedOptionId === option.id}
                  recommended={false}
                  evidence={evidence}
                  onOpenEvidence={onOpenEvidence}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    variant={selectedOptionId === option.id ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => onSelectOption(option.id)}
                  >
                    {selectedOptionId === option.id ? "已选择" : "选择备选"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {recommendation.output.uncertainties.length > 0 && (
        <section className="border-t border-border/70 pt-4">
          <h3 className="text-[12px] font-semibold text-text-muted">尚不确定</h3>
          <ul className="mt-2 space-y-1 text-[13px] leading-5 text-text-secondary">
            {recommendation.output.uncertainties.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}
    </section>
  );
}
