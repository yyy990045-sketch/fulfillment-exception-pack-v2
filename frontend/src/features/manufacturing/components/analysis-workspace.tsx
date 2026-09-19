import { ArrowDown, ArrowRight, FileText, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui/badge.js";
import { useDecisionRecommendation } from "../../../hooks/use-manufacturing.js";
import type { EvidenceBundleView } from "../types.js";
import { DecisionPanel } from "./decision-panel.js";
import { ExplanationPanel } from "./explanation-panel.js";
import { GovernanceProcess } from "./governance-process.js";
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
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="flex items-center gap-1.5"><FileText className="size-3.5" /> 证据 {evidence?.evidence.length ?? 0}</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" /> AI 解释</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span>根因假设</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span>决策建议</span>
        </div>
        <Link className="text-xs font-medium text-interactive hover:underline" to={`${base}/evidence`}>
          查看对应证据
        </Link>
      </div>

      <div className="py-5">
        <ExplanationPanel contextId={contextId} exceptionId={exceptionId} evidence={evidence} onOpenEvidence={onOpenEvidence} />
      </div>
      <div className="flex justify-center border-y border-border py-2 text-text-muted" aria-hidden="true">
        <ArrowDown className="size-4" />
      </div>
      <div className="py-5">
        <RootCausePanel contextId={contextId} exceptionId={exceptionId} evidence={evidence} onOpenEvidence={onOpenEvidence} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Badge>下一步</Badge>
          <span className="text-sm text-text-secondary">决策建议仅作为人工决策输入，不会自动执行。</span>
        </div>
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline" to={`${base}/decision`}>
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
  const [selectedOptionId, setSelectedOptionId] = useState<string>();

  useEffect(() => {
    if (recommendation && !selectedOptionId) {
      setSelectedOptionId(recommendation.output.recommendedOptionId);
    }
  }, [recommendation, selectedOptionId]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <Link className="hover:text-interactive" to={`${base}/evidence`}>证据 {evidence?.evidence.length ?? 0}</Link>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <Link className="hover:text-interactive" to={`${base}/analysis`}>AI 解释与根因假设</Link>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span>决策建议</span>
        </div>
        <Link className="text-xs font-medium text-interactive hover:underline" to={`${base}/analysis`}>
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
      <GovernanceProcess
        contextId={contextId}
        exceptionId={exceptionId}
        recommendation={recommendation}
        selectedOptionId={selectedOptionId}
      />
    </div>
  );
}
