import { ArrowRight, FileText, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ProductSection } from "../../../components/product/page-layout.js";
import { Button } from "../../../components/ui/button.js";
import { Badge } from "../../../components/ui/badge.js";
import { useDecisionRecommendation } from "../../../hooks/use-manufacturing.js";
import type { EvidenceBundleView } from "../types.js";
import { DecisionPanel } from "./decision-panel.js";
import { ExplanationPanel } from "./explanation-panel.js";
import { InlineEmpty, InlineError, SectionSkeleton } from "./query-state.js";
import { RootCausePanel } from "./root-cause-panel.js";

export function AnalysisWorkspace({
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
  const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;
  const [searchParams] = useSearchParams();
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="flex items-center gap-1.5"><FileText className="size-3.5" /> 证据 {evidence?.evidence.length ?? 0}</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" /> AI 解释</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span>根因假设</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span>决策建议</span>
        </div>
        <Link className="text-xs font-medium text-interactive hover:underline" to={`${base}/evidence${suffix}`}>
          查看对应证据
        </Link>
      </div>

      <ProductSection><div className="p-5"><ExplanationPanel contextId={contextId} exceptionId={exceptionId} evidence={evidence} onOpenEvidence={onOpenEvidence} /></div></ProductSection>
      <ProductSection><div className="p-5"><RootCausePanel contextId={contextId} exceptionId={exceptionId} evidence={evidence} onOpenEvidence={onOpenEvidence} /></div></ProductSection>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
        <div className="flex items-center gap-2">
          <Badge>下一步</Badge>
          <span className="text-sm text-text-secondary">决策建议仅作为人工决策输入，不会自动执行。</span>
        </div>
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline" to={`${base}/decision${suffix}`}>
          查看决策建议
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function DecisionWorkspace({
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
  const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;
  const decision = useDecisionRecommendation(contextId, exceptionId);
  const recommendation = decision.detail.data;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOptionId = searchParams.get("option") ?? recommendation?.output.recommendedOptionId;
  const setSelectedOptionId = (optionId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("option", optionId);
    setSearchParams(next, { replace: true });
  };
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <Link className="hover:text-interactive" to={`${base}/evidence${suffix}`}>证据 {evidence?.evidence.length ?? 0}</Link>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <Link className="hover:text-interactive" to={`${base}/analysis${suffix}`}>AI 解释与根因假设</Link>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span>决策建议</span>
        </div>
        <Link className="text-xs font-medium text-interactive hover:underline" to={`${base}/analysis${suffix}`}>
          返回分析
        </Link>
      </div>
      <div className="py-4">
        {(decision.list.isLoading || (decision.latest && decision.detail.isLoading)) ? (
          <SectionSkeleton />
        ) : decision.list.isError || decision.detail.isError ? (
          <InlineError title="处置建议加载失败" detail="当前建议记录无法读取。" />
        ) : !recommendation ? (
          <section aria-labelledby="decision-title">
            <h2 id="decision-title" className="text-sm font-semibold">决策建议</h2>
            <InlineEmpty />
          </section>
        ) : (
          <DecisionPanel
            recommendation={recommendation}
            selectedOptionId={selectedOptionId}
            onSelectOption={setSelectedOptionId}
            evidence={evidence}
            onOpenEvidence={onOpenEvidence}
          />
        )}
      </div>
      {recommendation && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm text-text-secondary">
            当前选择：{recommendation.output.options.find((option) => option.id === selectedOptionId)?.title ?? "待选择方案"}
          </span>
          <Button asChild>
            <Link to={`${base}/governance${suffix}`}>进入治理</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
