/**
 * Power BI 风格分析看板：画布网格 + 切片器 + 交叉筛选。
 * 四个分析模块各自使用不同的视觉结构（排行 / 阶段漏斗 / 分析表 / 来源占比），
 * 避免出现「同一个组件换标题」的观感。所有数值都来自后端 analytics 真实数据，
 * 点击可下钻的视觉会写回筛选条件（联动下方明细表）。
 */
import { ClipboardList, Stamp, TriangleAlert, UserRound } from "lucide-react";
import { resolutionStatusLabel, severityLabel } from "../../../lib/presentation.js";
import type { OperationalAnalyticsView } from "../types.js";
import {
  ColumnChart,
  DonutChart,
  MetricTile,
  RankingBars,
  RuleRateTable,
  SEVERITY_COLORS,
  SourceComposition,
  StageFunnel,
  VisualCard,
  VisualEmpty,
  VisualError,
  VisualLoading,
  formatPercent,
  hasValueSpread,
  type CategoryDatum,
  type RuleRateRow,
} from "./bi-visuals.js";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

const FUNNEL_ORDER = [
  "no_case",
  "triaged",
  "confirmed",
  "proposed_draft",
  "pending_approval",
  "approved",
  "executed",
  "closed",
  "rejected",
] as const;

/** 每个视觉模块统一的三态：error → loading → empty → 正常内容 */
function visualState({ loading, error, hasData }: { loading: boolean; error: boolean; hasData: boolean }) {
  if (error) return <VisualError />;
  if (loading) return <VisualLoading />;
  if (!hasData) return <VisualEmpty />;
  return null;
}

export function BiDashboard({
  view,
  loading,
  error,
  trend,
  buckets,
  bucketLabel,
  viewCounts,
  activeView,
  onSelectView,
  severity,
  onSelectSeverity,
  exceptionCode,
  onSelectExceptionCode,
  onSelectBucket,
  children,
}: {
  view: OperationalAnalyticsView | undefined;
  loading: boolean;
  error: boolean;
  trend: CategoryDatum[];
  buckets: Map<string, { from: string; to: string }>;
  bucketLabel: string;
  viewCounts: Record<string, number>;
  activeView: string;
  onSelectView: (view: string) => void;
  severity?: string;
  onSelectSeverity: (severity: string) => void;
  exceptionCode?: string;
  onSelectExceptionCode: (code: string) => void;
  onSelectBucket: (range: { from: string; to: string }) => void;
  children?: React.ReactNode;
}) {
  const severityData: CategoryDatum[] = (view?.severityBreakdown ?? [])
    .filter((item) => item.count > 0)
    .sort((left, right) => SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity))
    .map((item) => ({
      key: item.severity,
      label: severityLabel(item.severity),
      value: item.count,
      color: SEVERITY_COLORS[item.severity],
    }));

  // A. 异常类型排行：只保留排行阅读方式，按异常数量降序取前 6 类
  const exceptionRows = (view?.exceptionBreakdown ?? [])
    .slice()
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
  const exceptionData: CategoryDatum[] = exceptionRows.map((item) => ({
    key: item.code,
    label: item.label,
    value: item.count,
  }));
  const exceptionTruncated = (view?.exceptionBreakdown ?? []).length > exceptionData.length;

  // B. 治理推进漏斗：阶段顺序固定，0 值阶段保留
  const funnel = view?.resolutionFunnel;
  const funnelData: CategoryDatum[] = FUNNEL_ORDER.map((key) => ({
    key,
    label: resolutionStatusLabel(key),
    value: funnel ? Number(funnel[key] ?? 0) : 0,
  }));
  const funnelTotal = funnelData.reduce((sum, item) => sum + item.value, 0);

  // C. 规则触发率：分析表，命中与评估都是后端真实字段
  const ruleRowsAll = (view?.rulePerformance ?? [])
    .slice()
    .sort((left, right) => Number(right.triggerRate ?? 0) - Number(left.triggerRate ?? 0) || right.evaluations - left.evaluations);
  const ruleRows: RuleRateRow[] = ruleRowsAll.slice(0, 6).map((item) => ({
    key: item.code,
    label: item.label,
    matched: item.matched,
    evaluations: item.evaluations,
    rate: item.triggerRate === null || item.triggerRate === undefined ? null : Number(item.triggerRate),
  }));
  const ruleTruncated = ruleRowsAll.length > ruleRows.length;

  // D. 涉及来源系统：占比图，来源系统本身没有语义色，用分类色板
  const sourceRows = (view?.sourceSystemInvolvement ?? [])
    .slice()
    .sort((left, right) => right.involvedExceptionCount - left.involvedExceptionCount)
    .slice(0, 6);
  const sourceData: CategoryDatum[] = sourceRows.map((item) => ({
    key: item.sourceSystemId,
    label: item.name,
    value: item.involvedExceptionCount,
  }));
  const sourceTruncated = (view?.sourceSystemInvolvement ?? []).length > sourceData.length;

  const summary = view?.summary;
  const detected = summary?.detectedExceptionCount ?? 0;
  const contexts = view?.contexts.length ?? 0;
  const coverage = summary?.governanceCoverageRate ?? 0;
  const ruleEvaluations = summary?.ruleEvaluationCount ?? 0;
  const ruleTotal = ruleEvaluations > 0
    ? { matched: summary?.matchedRuleEvaluationCount ?? 0, evaluations: ruleEvaluations }
    : undefined;
  const coverageZero = coverage <= 0;
  const exceptionSpread = hasValueSpread(exceptionData);

  return (
    <div className="space-y-4">
      {/* 切片器书签：点击切换队列视图，等同于 Power BI 的书签/切片 */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={ClipboardList} label="待处理异常" value={loading ? "—" : viewCounts.pending} toneClass="bg-interactive/[0.08] text-interactive" active={activeView === "pending"} onClick={() => onSelectView("pending")} />
        <MetricTile icon={TriangleAlert} label="高风险异常" value={loading ? "—" : viewCounts.high_risk} toneClass="bg-danger/[0.08] text-danger" active={activeView === "high_risk"} onClick={() => onSelectView("high_risk")} />
        <MetricTile icon={Stamp} label="待审批" value={loading ? "—" : viewCounts.pending_approval} toneClass="bg-warning/[0.08] text-warning" active={activeView === "pending_approval"} onClick={() => onSelectView("pending_approval")} />
        <MetricTile icon={UserRound} label="无人负责" value={loading ? "—" : viewCounts.unassigned} toneClass="bg-surface-subtle text-text-secondary" active={activeView === "unassigned"} onClick={() => onSelectView("unassigned")} />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <VisualCard
          testId="bi-visual-trend"
          title="异常发生趋势"
          subtitle={`${bucketLabel} · 点击柱体可下钻该区间`}
          actions={<><span>合计</span><span className="font-semibold tabular-nums text-text-primary">{trend.reduce((sum, item) => sum + item.value, 0)}</span></>}
          className="col-span-12 xl:col-span-8"
        >
          {trend.length > 1 ? (
            <ColumnChart
              data={trend}
              onSelect={(key) => {
                const range = buckets.get(key);
                if (range) onSelectBucket(range);
              }}
            />
          ) : <VisualEmpty hint="当前时间粒度下不足两个数据点" />}
        </VisualCard>

        <VisualCard
          testId="bi-visual-severity"
          title="严重度分布"
          subtitle="点击切片可联动明细"
          className="col-span-12 xl:col-span-4"
        >
          <DonutChart data={severityData} {...(severity ? { selectedKey: severity } : {})} onSelect={onSelectSeverity} />
        </VisualCard>

        {/* A. 排行榜卡片：序号 + 名称 + 长度条 + 数量（数量无差异时不画长度） */}
        <VisualCard
          testId="bi-visual-exception"
          title="异常类型排行"
          subtitle={`${detected} 个异常 · ${contexts} 个业务上下文`}
          className="col-span-12 xl:col-span-6"
          bodyClassName="flex flex-col"
        >
          {visualState({ loading, error, hasData: exceptionData.length > 0 }) ?? (
            <>
              <RankingBars
                data={exceptionData}
                {...(exceptionCode ? { selectedKey: exceptionCode } : {})}
                onSelect={onSelectExceptionCode}
              />
              <p className="mt-3 text-[11px] text-text-muted">
                {exceptionSpread
                  ? `按异常数量排序${exceptionTruncated ? ` · 取前 ${exceptionData.length} 类` : ""} · 点击类型可下钻队列`
                  : "当前各类型数量相同，未按长度排序 · 点击类型可下钻队列"}
              </p>
            </>
          )}
        </VisualCard>

        {/* B. 阶段漏斗：逐级缩进收窄，0 值只留短痕 */}
        <VisualCard
          testId="bi-visual-funnel"
          title="治理推进漏斗"
          subtitle={`治理覆盖率 ${formatPercent(coverage)}`}
          className="col-span-12 xl:col-span-6"
          bodyClassName="flex flex-col"
        >
          {visualState({ loading, error, hasData: view !== undefined }) ?? (
            <>
              <StageFunnel data={funnelData} />
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
                {coverageZero && (
                  <span className="inline-flex items-center gap-1.5 text-warning">
                    <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                    治理尚未启动
                  </span>
                )}
                <span>阶段合计 {funnelTotal} · 短痕表示该阶段为 0</span>
              </p>
            </>
          )}
        </VisualCard>

        {/* C. 规则分析表：规则 + 热度命中率单元格 + 命中/评估 + 合计行 */}
        <VisualCard
          testId="bi-visual-rules"
          title="规则触发率"
          subtitle={ruleTruncated ? `命中评估 / 全部评估 · 前 ${ruleRows.length} 条` : "命中评估 / 全部评估"}
          className="col-span-12 xl:col-span-6"
          bodyClassName="flex flex-col"
        >
          {visualState({ loading, error, hasData: ruleRows.length > 0 }) ?? (
            <>
              <RuleRateTable rows={ruleRows} {...(ruleTotal ? { total: ruleTotal } : {})} />
              <p className="mt-3 text-[11px] text-text-muted">
                命中率 = 命中评估 / 全部评估，底色深浅只表示命中率高低。
              </p>
            </>
          )}
        </VisualCard>

        {/* D. 来源构成：分段环形 + 图例（数量与占比都来自真实数据） */}
        <VisualCard
          testId="bi-visual-sources"
          title="涉及来源系统"
          subtitle={sourceTruncated ? `按异常数据来源统计 · 前 ${sourceData.length} 个` : "按异常数据来源统计"}
          className="col-span-12 xl:col-span-6"
          bodyClassName="flex flex-col"
        >
          {visualState({ loading, error, hasData: sourceData.length > 0 }) ?? (
            <>
              <SourceComposition data={sourceData} />
              <p className="mt-3 text-[11px] text-text-muted">
                数量为该来源系统涉及的异常数，占比按来源合计计算。
              </p>
            </>
          )}
        </VisualCard>
      </div>

      {children}
    </div>
  );
}
