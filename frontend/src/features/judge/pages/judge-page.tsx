import { Link, useSearchParams } from "react-router-dom";
import {
  LocalState,
  ProductHeader,
  ProductLoading,
  ProductPage,
  ProductSection,
  SectionHeader,
  SummaryItem,
  SummaryStrip,
  recordWidthClass,
} from "../../../components/product/page-layout.js";
import { Badge, StatusDotBadge } from "../../../components/ui/badge.js";
import { severityLabel, severityTone } from "../../../lib/presentation.js";
import { useJudgeManifest } from "../../../hooks/use-judge.js";
import type { JudgeManifestView, JudgeSourceRefView } from "../types.js";

/**
 * 评委视图：**现有数据的只读聚合**，不是新系统、不是新 Dashboard。
 *
 * 一条主线：工业位置 → 业务问题 → 关键事实 → 证据 → 规则 → 异常 → 处理进度 → 最终结果。
 * 技术细节（UUID / hash / mapping 元数据）折叠进 details，第一屏只放业务语言。
 */
export function JudgePage() {
  const [searchParams] = useSearchParams();
  const requestedContextId = searchParams.get("contextId") ?? undefined;
  const manifest = useJudgeManifest(requestedContextId);
  const view = manifest.data;

  if (manifest.isLoading) {
    return <div data-testid="judge-loading"><ProductLoading /></div>;
  }
  if (manifest.isError || !view) {
    return (
      <ProductPage className="py-5">
        <LocalState
          kind="error"
          title="评委视图不可用"
          detail="请先运行 npm run demo:judge 生成仿真运行与原始载荷留存，再刷新本页。"
        />
      </ProductPage>
    );
  }

  const contextId = requestedContextId ?? "";
  const exceptionHref = view.exception
    ? `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(view.exception.id)}/overview`
    : null;
  const evidenceHref = view.exception
    ? `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(view.exception.id)}/evidence`
    : null;
  const sourceSystems = [...new Set(
    [view.sources.order?.systemKey, view.sources.production?.systemKey, view.sources.quality?.systemKey, view.sources.shipment?.systemKey].filter((item): item is string => Boolean(item)),
  )];
  const fulfillment = view.fulfillment;
  const currentCase = fulfillment?.cases.find((item) => item.caseId === fulfillment.currentCase);
  const statusLabel = (status: string) => ({
    NO_CONFLICT: "无冲突",
    WAITING_FOR_SOURCE_PROGRESS: "等待来源水位",
    FULFILLMENT_STATE_CONFLICT: "跨系统履约冲突",
    WAITING_FOR_EXECUTION_VERIFICATION: "等待执行回读",
    REVALIDATED_CLOSED: "重新验证并关闭",
  }[status] ?? status);

  return (
    <ProductPage className="space-y-3 py-5">
      <ProductHeader
        leading={<div className="mb-0.5 text-xs font-semibold text-interactive">履约哨兵 · Fulfillment Sentinel</div>}
        title="比赛评委视图"
        description="基于 open supOS UNS 的跨系统生产履约状态冲突处置 APP"
        badges={<Badge variant="info">SO-IND-001 · 离散制造</Badge>}
        footer={
          <span data-testid="judge-truth-boundary">
            场景 {view.scenario} · 仿真工业环境，不是真实工厂 · open supOS 运行时未验证
          </span>
        }
      />

      {fulfillment ? (
        <ProductSection className={recordWidthClass} data-testid="judge-fulfillment-summary">
          <SectionHeader
            title="当前履约状态"
            description="订单承诺 100 件，MES 已完成 96 件；四套工业系统属于同一订单行，并在共同水位上判断"
            meta={<StatusDotBadge variant={currentCase?.observedStateConflict ? "danger" : "success"}>{statusLabel(currentCase?.status ?? "")}</StatusDotBadge>}
          />
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            <FactCard system="ERP Order" value={`${fulfillment.facts.requiredQty} 件`} detail={`交期 ${fulfillment.facts.dueAt}`} tone="neutral" />
            <FactCard system="MES Production" value={`${fulfillment.facts.completedQty} / ${fulfillment.facts.requiredQty} 件`} detail={fulfillment.facts.productionState} tone="warning" />
            <FactCard system="QMS Quality" value={`released ${fulfillment.facts.releasedQty} 件`} detail="可放行数量" tone="warning" />
            <FactCard system="WMS Shipment" value={`execution committed ${fulfillment.facts.executionCommittedQty} 件`} detail="实际发运执行承诺" tone={fulfillment.facts.executionCommittedQty > fulfillment.facts.releasedQty ? "danger" : "neutral"} />
          </div>
          <div className="grid gap-3 border-t border-border p-4 md:grid-cols-3">
            <SummaryItem label="Global Watermark" value={currentCase?.globalWatermark || "—"} hint={`判断门槛 ${currentCase?.dueAtWithGrace || "—"}`} />
            <SummaryItem label="Business Lineage" value={fulfillment.lineage.status} hint={fulfillment.lineage.relation} />
            <SummaryItem label="Current Result" value={statusLabel(currentCase?.status ?? "")} hint={currentCase?.reason ?? "—"} />
          </div>
          <div className="border-t border-border px-4 py-3 text-sm text-text-secondary">
            {currentCase?.reason ?? "—"} <span className="ml-2 text-text-muted">{currentCase?.externalObligation}</span>
          </div>
        </ProductSection>
      ) : null}

      {fulfillment ? (
        <ProductSection className={recordWidthClass} data-testid="judge-case-path">
          <SectionHeader title="Judge Path A-E" description="处置不会让冲突消失；新的 WMS 来源事实到达后才重新验证关闭" />
          <div className="grid gap-2 p-4 md:grid-cols-5">
            {fulfillment.cases.map((item) => (
              <div key={item.caseId} className={`rounded-lg border p-3 ${item.caseId === fulfillment.currentCase ? "border-interactive bg-interactive/[0.06]" : "border-border bg-surface-subtle"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{item.caseId} · {item.label}</span>
                  {item.observedStateConflict ? <StatusDotBadge variant="danger">冲突</StatusDotBadge> : <StatusDotBadge variant="success">事实一致</StatusDotBadge>}
                </div>
                <p className="mt-2 text-xs font-medium text-text-secondary">{statusLabel(item.status)}</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">{item.reason}</p>
              </div>
            ))}
          </div>
        </ProductSection>
      ) : null}

      <ProductSection className={recordWidthClass}>
        <SectionHeader title="工业位置" description="UNS 空间：这条业务链发生在哪条产线上" />
        <SummaryStrip label="工业位置明细">
          <SummaryItem label="企业" value={view.industrialContext?.enterpriseId ?? "—"} />
          <SummaryItem label="工厂" value={view.industrialContext?.siteId ?? "—"} />
          <SummaryItem label="车间" value={view.industrialContext?.areaId ?? "—"} />
          <SummaryItem label="产线" value={view.industrialContext?.lineId ?? "—"} />
          <SummaryItem
            label="设备"
            value={view.industrialContext?.equipmentIds.length ?? 0}
            hint={<span className="break-all">{view.industrialContext?.equipmentIds.join(", ") ?? "—"}</span>}
          />
        </SummaryStrip>
      </ProductSection>

      <ProductSection className={recordWidthClass}>
        <SectionHeader title="关键事实" description="订单承诺 100 件，MES 已完成 96 件；数据来自哪些系统并保持可回溯" />
        <SummaryStrip label="关键事实明细">
          <SummaryItem label="订单承诺" value={view.businessFacts.orderedQuantity} hint={view.businessFacts.unit} />
          <SummaryItem label="MES 实际完工" value={view.businessFacts.productionCompletedQuantity} hint={view.businessFacts.unit} />
          <SummaryItem label="差异" value={view.businessFacts.difference} hint={view.businessFacts.unit} />
          <SummaryItem label="涉及来源系统" value={sourceSystems.length} hint={<span className="break-all">{sourceSystems.join(" / ") || "—"}</span>} />
        </SummaryStrip>
      </ProductSection>

      <ProductSection className={recordWidthClass}>
        <SectionHeader
          title="证据与来源"
          description="每条结论都能回到具体系统与具体材料；展开可见证据 ID、UNS topic 与观测时间。"
          actions={evidenceHref ? <Link className="text-interactive" to={evidenceHref}>查看证据链</Link> : undefined}
        />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <SourceCard title="订单数量（期望）" source={view.sources.order} fallback="ERP 订单" />
          <SourceCard title="生产完工（实际）" source={view.sources.production} fallback="MES 工单" />
          {view.sources.quality ? <SourceCard title="质量放行数量" source={view.sources.quality} fallback="QMS 检验" /> : null}
          {view.sources.shipment ? <SourceCard title="实际发运执行承诺" source={view.sources.shipment} fallback="WMS 发运" /> : null}
        </div>
        <details className="mx-4 mb-4 rounded-md border border-border bg-surface-subtle p-3 text-xs text-text-secondary">
          <summary className="cursor-pointer">查看 UNS topic 与留存载荷</summary>
          <ul className="mt-2 space-y-1 break-all">
            <li>订单：{view.uns.orderTopic ?? "—"}</li>
            <li>完工：{view.uns.productionTopic ?? "—"}</li>
            <li>topic 约定：{view.uns.topicConvention}</li>
            <li>原始载荷留存：{view.trace.payloadSourcePath ?? "—"}</li>
          </ul>
        </details>
      </ProductSection>

      <ProductSection className={recordWidthClass}>
        <SectionHeader
          title="规则判定与异常"
          description={`规则 ${view.rule.code} → 判定 ${view.rule.result}`}
          meta={view.exception
            ? <StatusDotBadge variant={severityTone(view.exception.severity)}>{severityLabel(view.exception.severity)}</StatusDotBadge>
            : undefined}
        />
        <SummaryStrip label="异常明细">
          <SummaryItem label="异常编码" value={view.exception?.code ?? "无异常"} />
          <SummaryItem label="期望 / 实际" value={`${view.rule.expected ?? "—"} / ${view.rule.actual ?? "—"}`} />
          <SummaryItem label="差异" value={view.rule.difference ?? "—"} />
          <SummaryItem label="依据证据条数" value={view.evidence.totalCount} />
        </SummaryStrip>
        {view.exception ? (
          <p className="p-4 text-sm text-text-secondary">
            {view.exception.title}：{view.exception.summary}
            {exceptionHref ? <Link className="ml-2 text-interactive" to={exceptionHref}>查看异常详情</Link> : null}
          </p>
        ) : (
          <p className="p-4 text-sm text-text-secondary">当前 Context 未产生异常。</p>
        )}
      </ProductSection>

      <ProductSection className={recordWidthClass}>
        <SectionHeader
          title="处理进度与最终结果"
          description="AI 只给解释与候选动作；审批与执行必须由人完成，且执行必须回读一致。"
        />
        <SummaryStrip label="处理进度明细">
          <SummaryItem label="治理状态" value={view.governance.status} hint={`阶段 ${view.governance.stage}`} />
          <SummaryItem label="执行状态" value={view.execution.status} hint={view.execution.downstream ?? "下游回读"} />
          <SummaryItem label="结果状态" value={view.outcome.status} hint="不主张因果关系" />
          <SummaryItem label="证据回源" value={view.trace.status} hint={`${view.trace.evidenceLinks} 条证据`} />
        </SummaryStrip>
        {view.trace.failures.length ? (
          <div data-testid="judge-gate-blocked" className="m-4 rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
            <p className="font-medium">关键证据无法回源：审批与执行已被闸门阻止（异常保留）</p>
            <ul className="mt-1 space-y-0.5">
              {view.trace.failures.map((failure) => <li key={failure}>{failure}</li>)}
            </ul>
          </div>
        ) : null}
        <details className="mx-4 mb-4 rounded-md border border-border bg-surface-subtle p-3 text-xs text-text-secondary">
          <summary className="cursor-pointer">查看 AI 角色与执行回读细节</summary>
          <ul className="mt-2 space-y-1">
            <li>AI provider：{view.ai.provider} / {view.ai.model}</li>
            <li>AI 建议 ID：{view.ai.recommendationId ?? "—"}（{view.ai.recommendationStatus ?? "—"}）</li>
            <li>AI 可否批准：{String(view.ai.canApprove)}；可否执行：{String(view.ai.canExecute)}</li>
            <li>执行回执：{view.execution.receiptId ?? "—"}</li>
            <li>回读不一致项：{view.execution.mismatches.length ? view.execution.mismatches.join(", ") : "无"}</li>
            <li>结果基线 / 当前 / 目标：{String(view.outcome.baseline ?? "—")} / {String(view.outcome.current ?? "—")} / {String(view.outcome.target ?? "—")}</li>
            <li>结果定义：{view.outcome.definitionId ?? "—"}</li>
            <li>治理：受理角色 {view.governance.ownerRole ?? "—"}；提出人 {view.governance.proposedBy ?? "—"}；批准人 {view.governance.approvedBy ?? "—"}</li>
          </ul>
        </details>
      </ProductSection>
    </ProductPage>
  );
}

function FactCard({ system, value, detail, tone }: { system: string; value: string; detail: string; tone: "neutral" | "warning" | "danger" }) {
  const toneClass = tone === "danger" ? "bg-danger/[0.06]" : tone === "warning" ? "bg-warning/[0.06]" : "bg-surface";
  return (
    <div className={`min-h-[116px] p-4 ${toneClass}`}>
      <p className="text-xs font-medium text-text-muted">{system}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-text-primary">{value}</p>
      <p className="mt-1 text-xs text-text-secondary">{detail}</p>
    </div>
  );
}

function SourceCard({
  title,
  source,
  fallback,
}: {
  title: string;
  source: JudgeSourceRefView | null;
  fallback: string;
}) {
  if (!source) {
    return (
      <div className="rounded-md border border-border bg-surface-subtle p-3 text-sm text-text-muted">
        {title}：{fallback} 未提供
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface-subtle p-3 text-sm">
      <p className="font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-text-secondary">{source.systemKey}（{source.systemType ?? "unknown"}）</p>
      <p className="mt-1 text-text-primary">{source.field} = {String(source.value)}</p>
      <details className="mt-2 text-xs text-text-muted">
        <summary className="cursor-pointer">查看来源</summary>
        <ul className="mt-1 space-y-0.5 break-all">
          <li>证据：{source.evidenceId}</li>
          <li>材料：{source.sourceDocumentId}</li>
          <li>观测时间：{source.observedAt}</li>
          <li>topic：{source.unsTopic ?? "—"}</li>
        </ul>
      </details>
    </div>
  );
}

export type { JudgeManifestView };
