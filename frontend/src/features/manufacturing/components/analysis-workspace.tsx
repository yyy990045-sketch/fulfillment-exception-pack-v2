import { ArrowRight, FileText, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ProductSection } from "../../../components/product/page-layout.js";
import { Button } from "../../../components/ui/button.js";
import { Badge } from "../../../components/ui/badge.js";
import {
  useDecisionRecommendation,
  useGenerateDecisionRecommendation,
  usePolicyEvaluations,
  useResolutionCapabilities,
} from "../../../hooks/use-manufacturing.js";
import type { EvidenceBundleView } from "../types.js";
import { DecisionPanel } from "./decision-panel.js";
import { DecisionInformationPanel, DecisionNextStepPanel, PolicyRequirementPanel } from "./decision-support-panels.js";
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
          <span>建议处理</span>
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
          <span className="text-sm text-text-secondary">建议仅作为人工决策输入，不会自动执行。</span>
        </div>
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-interactive hover:underline" to={`${base}/decision${suffix}`}>
          查看建议处理
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
  const generateDecision = useGenerateDecisionRecommendation(contextId, exceptionId);
  const policy = usePolicyEvaluations(contextId, exceptionId);
  const capabilities = useResolutionCapabilities(contextId, exceptionId);
  const recommendation = decision.detail.data;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOptionId = searchParams.get("option") ?? recommendation?.output.recommendedOptionId;
  const selectedOption = recommendation?.output.options.find((option) => option.id === selectedOptionId);
  const currentPolicy = policy.data?.evaluations
    .filter((item) => item.sourceRecommendationId === recommendation?.id && item.sourceOptionId === selectedOptionId)
    .at(-1);
  const setSelectedOptionId = (optionId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("option", optionId);
    setSearchParams(next, { replace: true });
  };
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const governanceHref = `${base}/governance${suffix}`;
  const decisionLoading = decision.list.isLoading || Boolean(decision.latest && decision.detail.isLoading);
  const decisionError = decision.list.isError || decision.detail.isError;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <Link className="hover:text-interactive" to={`${base}/evidence${suffix}`}>证据 {evidence?.evidence.length ?? 0}</Link>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <Link className="hover:text-interactive" to={`${base}/analysis${suffix}`}>AI 解释与根因假设</Link>
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span>建议处理</span>
        </div>
        <Link className="text-xs font-medium text-interactive hover:underline" to={`${base}/analysis${suffix}`}>
          返回分析
        </Link>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 py-1">
          {decisionLoading ? (
            <SectionSkeleton />
          ) : decisionError ? (
            <div className="space-y-3">
              <h2 id="decision-title" className="text-[15px] font-semibold">建议处理</h2>
              <InlineError title="智能建议加载失败" detail="当前建议记录无法读取，Policy 和人工治理仍可继续。" />
              <Button variant="outline" onClick={() => generateDecision.mutate()} disabled={generateDecision.isPending}>
                {generateDecision.isPending ? "正在生成..." : "重试智能建议信息"}
              </Button>
            </div>
          ) : !recommendation ? (
            <div className="space-y-3">
              <h2 id="decision-title" className="text-[15px] font-semibold">建议处理</h2>
              <InlineEmpty message="暂无处置建议" />
              <Button variant="outline" onClick={() => generateDecision.mutate()} disabled={generateDecision.isPending}>
                {generateDecision.isPending ? "正在生成..." : "生成处置建议"}
              </Button>
              {generateDecision.isError && <p className="text-xs text-warning">智能建议信息暂不可用，Policy 和人工治理仍可继续。</p>}
            </div>
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
        <div className="space-y-4">
          <DecisionInformationPanel recommendation={recommendation} loading={decisionLoading} error={decisionError} />
          <PolicyRequirementPanel
            policy={currentPolicy}
            loading={policy.isLoading}
            error={policy.isError}
            governanceHref={governanceHref}
          />
          <DecisionNextStepPanel
            capabilities={capabilities.data?.resolutionCapabilities}
            loading={capabilities.isLoading}
            error={capabilities.isError}
            governanceHref={governanceHref}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-sm text-text-secondary">
          当前选择：{selectedOption?.title ?? "待选择方案"}；AI 建议不能替代 Policy 或人工决策。
        </span>
        <Button asChild>
          <Link to={governanceHref}>进入治理</Link>
        </Button>
      </div>
    </div>
  );
}
