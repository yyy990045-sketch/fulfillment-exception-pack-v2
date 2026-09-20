/**
 * 制造履约工作台的 Power BI 风格画布：
 * 磁贴切片 + 三个交叉筛选视觉（严重度 / 处理阶段 / 业务阶段），点击即联动下方异常队列。
 */
import { FileCheck2, Layers, ShieldAlert, Workflow } from "lucide-react";
import { governanceStageLabel } from "../exception-queue.js";
import { severityLabel } from "../../../lib/presentation.js";
import {
  BarChart,
  DonutChart,
  MetricTile,
  SEVERITY_COLORS,
  VisualCard,
  type CategoryDatum,
} from "../../operations/components/bi-visuals.js";
import type { ExceptionView, WorkbenchView } from "../types.js";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

const GOVERNANCE_ORDER = [
  "not_started",
  "review",
  "proposal",
  "proposal_draft",
  "pending_approval",
  "approved",
  "executed",
  "closed",
  "rejected",
] as const;

function countBy(values: string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

export function ContextBiDashboard({
  view,
  severity,
  onSelectSeverity,
  governanceStage,
  onSelectGovernanceStage,
  stageKey,
  onSelectStageKey,
  onResetFilters,
}: {
  view: WorkbenchView;
  severity?: string;
  onSelectSeverity: (severity: string) => void;
  governanceStage?: string;
  onSelectGovernanceStage: (stage: string) => void;
  stageKey?: string;
  onSelectStageKey: (stageKey: string) => void;
  onResetFilters: () => void;
}) {
  const exceptions = view.exceptions;
  const pendingCount = exceptions.filter(
    (exception) => exception.governanceStage === "not_started" || exception.governanceStage === "review",
  ).length;

  const severityData: CategoryDatum[] = SEVERITY_ORDER
    .map((level) => ({
      key: level,
      label: severityLabel(level),
      value: exceptions.filter((exception) => exception.severity === level).length,
      color: SEVERITY_COLORS[level],
    }))
    .filter((item) => item.value > 0);

  const governanceCounts = countBy(exceptions.map((exception) => exception.governanceStage));
  const governanceData: CategoryDatum[] = GOVERNANCE_ORDER.map((stage) => ({
    key: stage,
    label: governanceStageLabel(stage),
    value: governanceCounts.get(stage as ExceptionView["governanceStage"]) ?? 0,
  })).filter((item) => item.value > 0);

  const stageCounts = countBy(exceptions.flatMap((exception) => exception.stageKeys));
  const stageData: CategoryDatum[] = view.thread
    .map((stage) => ({ key: stage.key, label: stage.label, value: stageCounts.get(stage.key) ?? 0 }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={ShieldAlert}
          label="异常总数"
          value={view.stats.exceptions}
          toneClass="bg-danger/[0.08] text-danger"
          active={!severity && !governanceStage && !stageKey}
          onClick={onResetFilters}
        />
        <MetricTile
          icon={Layers}
          label="待治理"
          value={pendingCount}
          toneClass="bg-warning/[0.08] text-warning"
          active={governanceStage === "not_started"}
          onClick={() => onSelectGovernanceStage(governanceStage === "not_started" ? "" : "not_started")}
        />
        <MetricTile
          icon={Workflow}
          label="命中规则"
          value={`${view.stats.matchedRules}/${view.stats.ruleEvaluations}`}
          toneClass="bg-interactive/[0.08] text-interactive"
          active={false}
          onClick={onResetFilters}
        />
        <MetricTile
          icon={FileCheck2}
          label="治理案件"
          value={view.stats.resolutionCases}
          toneClass="bg-surface-subtle text-text-secondary"
          active={false}
          onClick={onResetFilters}
        />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <VisualCard
          testId="ctx-visual-severity"
          title="严重度分布"
          subtitle="点击切片联动异常队列"
          className="col-span-12 xl:col-span-4"
        >
          <DonutChart data={severityData} {...(severity ? { selectedKey: severity } : {})} onSelect={onSelectSeverity} />
        </VisualCard>

        <VisualCard
          testId="ctx-visual-governance"
          title="处理阶段分布"
          subtitle="按治理推进阶段统计"
          className="col-span-12 xl:col-span-4"
        >
          <BarChart data={governanceData} {...(governanceStage ? { selectedKey: governanceStage } : {})} onSelect={onSelectGovernanceStage} />
        </VisualCard>

        <VisualCard
          testId="ctx-visual-stages"
          title="业务阶段异常分布"
          subtitle="点击阶段查看该阶段异常"
          className="col-span-12 xl:col-span-4"
        >
          <BarChart data={stageData} {...(stageKey ? { selectedKey: stageKey } : {})} onSelect={onSelectStageKey} />
        </VisualCard>
      </div>
    </div>
  );
}
