import { ArrowRight, Info, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { ProductSection, SectionHeader } from "../../../components/product/page-layout.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import type {
  CapabilityDecisionView,
  DecisionRecommendationView,
  PolicyEvaluationView,
} from "../analysis-types.js";
import {
  actionTypeLabel,
  decisionProviderLabel,
  formatShortDateTime,
  policyEffectClassLabel,
  policyModeLabel,
  policyReasonLabel,
} from "../utils.js";
import { InlineError, SectionSkeleton } from "./query-state.js";

export function DecisionInformationPanel({
  recommendation,
  loading = false,
  error = false,
}: {
  recommendation: DecisionRecommendationView | undefined;
  loading?: boolean;
  error?: boolean;
}) {
  return (
    <ProductSection>
      <SectionHeader
        title="智能建议信息"
        description="该信息描述当前处置建议的生成来源，不代表 Policy 判断或执行许可。"
        meta={<Badge variant={recommendation ? "info" : "default"}>{recommendation ? "建议已生成" : "暂不可用"}</Badge>}
      />
      {loading ? (
        <div className="p-4"><SectionSkeleton /></div>
      ) : error ? (
        <div className="p-4"><InlineError title="智能建议信息暂不可用" detail="Policy 和人工治理流程不受影响。" /></div>
      ) : recommendation ? (
        <div className="space-y-3 p-4">
          <p className="text-[13px] font-medium text-text-secondary">人工决策要求：是</p>
          <p className="text-xs text-text-muted">当前建议仅作为人工决策输入。</p>
          <p className="text-xs text-text-muted">建议来源：{decisionProviderLabel(recommendation.provider)}</p>
          <details className="border-t border-border/70 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-text-secondary">技术信息</summary>
            <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
              <dt className="text-text-muted">Provider</dt><dd className="break-all text-text-secondary">{recommendation.provider}</dd>
              <dt className="text-text-muted">Model</dt><dd className="break-all text-text-secondary">{recommendation.model}</dd>
              <dt className="text-text-muted">Generated at</dt><dd className="text-text-secondary">{formatShortDateTime(recommendation.createdAt)}</dd>
            </dl>
          </details>
        </div>
      ) : (
        <div className="flex gap-2.5 p-4 text-xs text-text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-text-secondary">智能建议信息暂不可用</p>
            <p className="mt-0.5">Policy 和人工治理流程不受影响。</p>
          </div>
        </div>
      )}
    </ProductSection>
  );
}

export function PolicyRequirementPanel({
  policy,
  loading,
  error,
  governanceHref,
}: {
  policy: PolicyEvaluationView | undefined;
  loading: boolean;
  error: boolean;
  governanceHref: string;
}) {
  if (loading) {
    return (
      <ProductSection>
        <SectionHeader title="治理要求" />
        <div className="p-4"><SectionSkeleton /></div>
      </ProductSection>
    );
  }
  if (error) {
    return (
      <ProductSection>
        <SectionHeader title="治理要求" />
        <div className="p-4"><InlineError title="治理要求加载失败" detail="Policy 边界暂时无法读取。" /></div>
      </ProductSection>
    );
  }
  return (
    <ProductSection className="border-interactive/25">
      <SectionHeader
        title="治理要求"
        description="Policy Engine 决定治理模式，AI 不能批准或执行。"
        meta={policy ? <Badge variant={policy.stale ? "warning" : "info"}>{policy.stale ? "已变化" : policyModeLabel(policy.decision.mode)}</Badge> : undefined}
      />
      {policy ? (
        <div className="space-y-3 p-4">
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="text-text-muted">处理方式</dt><dd className="mt-0.5 font-medium text-text-secondary">{policyModeLabel(policy.decision.mode)}</dd></div>
            <div><dt className="text-text-muted">审批角色</dt><dd className="mt-0.5 font-medium text-text-secondary">{policy.decision.requiredRoles.join("、") || "无需独立审批"}</dd></div>
            <div><dt className="text-text-muted">业务动作</dt><dd className="mt-0.5 text-text-secondary">{actionTypeLabel(policy.candidateActionType)}</dd></div>
            <div><dt className="text-text-muted">业务影响</dt><dd className="mt-0.5 text-text-secondary">{policyEffectClassLabel(policy.decision.actionMetadata.effectClass)}</dd></div>
          </dl>
          {policy.decision.reasons.length > 0 && (
            <div className="border-l-2 border-interactive/35 pl-3">
              <p className="text-[11px] font-medium text-text-muted">原因</p>
              <ul className="mt-1 space-y-1 text-xs leading-5 text-text-secondary">
                {policy.decision.reasons.map((reason) => <li key={reason}>{policyReasonLabel(reason)}</li>)}
              </ul>
            </div>
          )}
          {policy.stale && <p className="text-xs text-warning">治理要求基于旧快照，请重新确认后再处理。</p>}
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex gap-2.5 text-xs text-text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium text-text-secondary">治理要求尚未确认</p>
              <p className="mt-0.5">请先进入治理工作区确认 Policy 边界。</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to={governanceHref}>进入治理确认</Link>
          </Button>
        </div>
      )}
    </ProductSection>
  );
}

export function DecisionNextStepPanel({
  capabilities,
  loading,
  error,
  governanceHref,
}: {
  capabilities: {
    canAccept: CapabilityDecisionView;
    canReview: CapabilityDecisionView;
    canPropose: CapabilityDecisionView;
    canSubmit: CapabilityDecisionView;
    canApprove: CapabilityDecisionView;
    canExecute: CapabilityDecisionView;
    canClose: CapabilityDecisionView;
  } | undefined;
  loading: boolean;
  error: boolean;
  governanceHref: string;
}) {
  const items = capabilities ? [
    ["canAccept", "提交人工复核"],
    ["canReview", "提交复核结论"],
    ["canPropose", "拟定处置方案"],
    ["canSubmit", "提交审批"],
    ["canApprove", "批准方案"],
    ["canExecute", "执行已批准方案"],
    ["canClose", "核验回执并结案"],
  ].flatMap(([key, label]) => {
    const capability = capabilities[key as keyof typeof capabilities];
    return capability.applicable ? [{ key, label, capability }] : [];
  }) : [];
  return (
    <ProductSection>
      <SectionHeader title="下一步" description="动作可用性来自后端权限与流程状态。" />
      {loading ? (
        <div className="p-4"><SectionSkeleton /></div>
      ) : error ? (
        <div className="p-4"><InlineError title="处理权限加载失败" detail="暂时无法读取当前可用动作。" /></div>
      ) : items.length ? (
        <div className="space-y-3 p-4">
          {items.map(({ key, label, capability }) => (
            <div key={key}>
              {capability.allowed ? (
                <Button asChild size="sm" variant={key === "canAccept" || key === "canSubmit" ? "default" : "outline"}>
                  <Link to={governanceHref}>{label} <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" disabled>{label}</Button>
                  <p className="mt-1 text-[11px] text-warning">{capability.reason}</p>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <p className="text-xs text-text-muted">当前没有可执行的治理操作。</p>
          <Button asChild variant="outline" size="sm"><Link to={governanceHref}>进入治理查看</Link></Button>
        </div>
      )}
    </ProductSection>
  );
}
