/**
 * Power BI 风格可视化原语：纯 SVG 实现，不引入图表库。
 * 约定：所有图表只接收后端真实数据，数据为空时渲染空态，不画装饰。
 */
import { AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../../lib/utils.js";

export type CategoryDatum = {
  key: string;
  label: string;
  value: number;
  color?: string;
};

/** 语义色板：严重度在各看板间保持一致 */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: "#b42318",
  high: "#e8590c",
  medium: "#f59f00",
  low: "#98a2b3",
};

export const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

/** 分类色板：用于来源系统这类本身无语义的维度，只保证维度内可区分 */
export const CATEGORICAL_COLORS = [
  "#2f6feb",
  "#0e9f6e",
  "#e8590c",
  "#7c3aed",
  "#0891b2",
  "#b42318",
  "#8b5a2b",
  "#5b6472",
];

/** 全站统一百分比格式：默认取整，避免同一页出现多种小数位 */
export function formatPercent(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** 切片磁贴：点击写入筛选条件，等同 Power BI 的书签切片 */
export function MetricTile({
  icon: Icon,
  label,
  value,
  toneClass,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  toneClass: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface px-3.5 py-3 text-left shadow-card transition-all duration-150 hover:shadow-raised",
        active ? "border-interactive/45 ring-1 ring-interactive/25" : "border-border/80 hover:border-border-strong",
      )}
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", toneClass)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] text-text-muted">{label}</span>
        <span className={cn(
          "mt-0.5 block text-[20px] font-semibold leading-6 tracking-tight tabular-nums",
          active ? "text-interactive" : "text-text-primary",
        )}>
          {value}
        </span>
      </span>
    </button>
  );
}

/** 视觉卡片容器：标题栏 + 视觉区，对齐 Power BI 的 visual container */
export function VisualCard({
  title,
  subtitle,
  actions,
  className,
  bodyClassName,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border/80 bg-surface shadow-card", className)}
    >
      <header className="flex min-h-[42px] flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-[12.5px] font-semibold leading-4">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-[10.5px] leading-4 text-text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">{actions}</div>}
      </header>
      <div className={cn("min-w-0 flex-1 px-3.5 py-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function VisualEmpty({ hint = "当前筛选下没有数据" }: { hint?: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center text-[11px] text-text-muted">{hint}</div>
  );
}

export function VisualLoading({ hint = "正在加载分析数据" }: { hint?: string } = {}) {
  return (
    <div className="h-full min-h-[120px] space-y-2 py-1" role="status" aria-label={hint}>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="h-4 animate-pulse rounded-sm bg-surface-muted"
          style={{ width: `${100 - index * 14}%` }}
        />
      ))}
    </div>
  );
}

export function VisualError({ hint = "该视觉暂时无法加载，请刷新后重试" }: { hint?: string } = {}) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 text-[11px] text-text-muted">
      <AlertCircle className="size-4" aria-hidden="true" />
      <span>{hint}</span>
    </div>
  );
}

/** 纵向柱图：用于时间趋势，支持点击交叉筛选 */
export function ColumnChart({
  data,
  selectedKey,
  onSelect,
}: {
  data: CategoryDatum[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  if (!data.length) return <VisualEmpty />;
  const max = Math.max(...data.map((item) => item.value), 1);
  const height = 132;
  const labelHeight = 18;
  const slot = 100 / data.length;
  // viewBox 横向会被拉伸（preserveAspectRatio=none），柱宽需按 100 单位坐标预估实际像素收窄
  const barWidth = Math.min(slot * 0.5, 4.5);
  return (
    <div className="w-full">
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="趋势柱状图">
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={0}
              x2={100}
              y1={height - ratio * (height - labelHeight)}
              y2={height - ratio * (height - labelHeight)}
              stroke="var(--border)"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {data.map((item, index) => {
            const barHeight = (item.value / max) * (height - labelHeight - 6);
            const x = index * slot + (slot - barWidth) / 2;
            return (
              <rect
                key={item.key}
                x={x}
                y={height - labelHeight - barHeight}
                width={barWidth}
                height={Math.max(barHeight, item.value > 0 ? 2 : 0)}
                rx={1}
                fill={selectedKey === item.key ? "var(--color-interactive)" : "color-mix(in srgb, var(--color-interactive) 62%, white)"}
              >
                <title>{`${item.label}：${item.value}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex overflow-hidden" style={{ height: labelHeight }}>
        {data.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px] tabular-nums transition-colors",
              selectedKey === item.key ? "text-interactive" : "text-text-muted",
              onSelect && "hover:text-interactive",
            )}
            style={{ maxWidth: `${slot}%` }}
            onClick={() => onSelect?.(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 横向条形图：Power BI 里最常见的分类排名视觉 */
export function BarChart({
  data,
  selectedKey,
  onSelect,
  valueSuffix = "",
}: {
  data: CategoryDatum[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  valueSuffix?: string;
}) {
  if (!data.length) return <VisualEmpty />;
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <ul className="space-y-2">
      {data.map((item) => {
        const active = selectedKey === item.key;
        return (
          <li key={item.key}>
            <button
              type="button"
              className={cn(
                "group flex w-full items-center gap-2.5 text-left",
                onSelect && "cursor-pointer",
              )}
              onClick={() => onSelect?.(item.key)}
              aria-pressed={active}
            >
              <span className={cn(
                "min-w-0 flex-1 truncate text-[11.5px] transition-colors",
                active ? "font-medium text-interactive" : "text-text-secondary group-hover:text-text-primary",
              )}>
                {item.label}
              </span>
              <span className="relative h-3 min-w-[80px] flex-1 overflow-hidden rounded-sm bg-surface-subtle">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm transition-all duration-200"
                  style={{
                    width: `${(item.value / max) * 100}%`,
                    background: item.color ?? (active ? "var(--color-interactive)" : "color-mix(in srgb, var(--color-interactive) 55%, white)"),
                  }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-text-primary">
                {item.value}{valueSuffix}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 环形图：严重度占比，中心显示合计，图例可点击交叉筛选 */
export function DonutChart({
  data,
  selectedKey,
  onSelect,
}: {
  data: CategoryDatum[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <VisualEmpty />;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-[112px] shrink-0 -rotate-90" role="img" aria-label="严重度占比">
        <circle cx={50} cy={50} r={radius} fill="none" stroke="var(--surface-subtle)" strokeWidth={13} />
        {data.map((item) => {
          const length = (item.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const element = (
            <circle
              key={item.key}
              cx={50}
              cy={50}
              r={radius}
              fill="none"
              stroke={item.color ?? "var(--color-interactive)"}
              strokeWidth={selectedKey && selectedKey === item.key ? 16 : 13}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              opacity={selectedKey && selectedKey !== item.key ? 0.32 : 1}
            >
              <title>{`${item.label}：${item.value}`}</title>
            </circle>
          );
          offset += length;
          return element;
        })}
        <text
          x={50}
          y={50}
          textAnchor="middle"
          dominantBaseline="central"
          className="rotate-90 fill-[--text-primary]"
          style={{ transformOrigin: "50px 50px", fontSize: 20, fontWeight: 600 }}
        >
          {total}
        </text>
      </svg>
      <ul className="min-w-[120px] flex-1 space-y-1.5">
        {data.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 text-[11.5px] transition-opacity",
                selectedKey && selectedKey !== item.key && "opacity-55",
              )}
              onClick={() => onSelect?.(item.key)}
              aria-pressed={selectedKey === item.key}
            >
              <span className="size-2 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-text-secondary">{item.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{item.value}</span>
              <span className="w-9 shrink-0 text-right text-[10px] text-text-muted tabular-nums">
                {formatPercent(item.value / total)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 排行榜条：左侧排名序号 + 类型名，中间长度条，右侧数量与占比。
 * 页面上只用于「异常类型排行」这一处，保留排名的阅读方式。
 */
export function RankingBars({
  data,
  selectedKey,
  onSelect,
}: {
  data: CategoryDatum[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  if (!data.length) return <VisualEmpty />;
  const max = Math.max(...data.map((item) => item.value), 1);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <ol data-testid="visual-ranking-bars" className="space-y-1">
      {data.map((item, index) => {
        const active = selectedKey === item.key;
        const rank = index + 1;
        return (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect?.(item.key)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-md py-1 text-left transition-colors",
                onSelect && "cursor-pointer",
              )}
            >
              <span className={cn(
                "flex size-[18px] shrink-0 items-center justify-center rounded-[4px] text-[10.5px] font-semibold tabular-nums",
                rank === 1
                  ? "bg-interactive text-white"
                  : rank <= 3
                    ? "bg-interactive/[0.12] text-interactive"
                    : "bg-surface-subtle text-text-muted",
              )}>
                {rank}
              </span>
              <span
                title={item.label}
                className={cn(
                  "w-[36%] min-w-0 shrink-0 truncate text-[11.5px] transition-colors",
                  active ? "font-medium text-interactive" : "text-text-secondary group-hover:text-text-primary",
                )}
              >
                {item.label}
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                <span
                  className="block h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${Math.max((item.value / max) * 100, 2)}%`,
                    background: item.color ?? (active ? "var(--color-interactive)" : "color-mix(in srgb, var(--color-interactive) 62%, white)"),
                  }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums text-text-primary">{item.value}</span>
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-text-muted">
                {total ? formatPercent(item.value / total) : "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 阶段漏斗：居中收窄的分段结构，用于表达治理流程的阶段推进与收敛。
 * 值为 0 的阶段保留为虚线占位，弱化但不隐藏。
 */
export function StageFunnel({ data }: { data: CategoryDatum[] }) {
  if (!data.length) return <VisualEmpty />;
  const max = Math.max(...data.map((item) => item.value), 1);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <ol data-testid="visual-stage-funnel" className="space-y-1">
      {data.map((item, index) => {
        const value = Math.max(item.value, 0);
        const zero = value === 0;
        // 非零阶段保留 12% 下限，避免小数值被压成不可见；0 值阶段用更窄的虚线占位
        const width = zero ? 10 : Math.max((value / max) * 100, 12);
        return (
          <li key={item.key} className="grid grid-cols-[92px_1fr_46px] items-center gap-2">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-[10px] tabular-nums text-text-muted">{String(index + 1).padStart(2, "0")}</span>
              <span
                title={item.label}
                className={cn("min-w-0 truncate text-[11px]", zero ? "text-text-muted" : "text-text-secondary")}
              >
                {item.label}
              </span>
            </span>
            <span className="flex h-6 items-center justify-center">
              {zero ? (
                <span
                  className="flex h-full items-center justify-center rounded-[4px] border border-dashed border-border-strong"
                  style={{ width: `${width}%` }}
                >
                  <span className="text-[10.5px] tabular-nums text-text-muted">0</span>
                </span>
              ) : (
                <span
                  className="flex h-full items-center justify-center rounded-[4px] bg-interactive transition-all duration-200"
                  style={{ width: `${width}%` }}
                >
                  <span className="text-[11px] font-semibold tabular-nums text-white">{value}</span>
                </span>
              )}
            </span>
            <span className={cn("text-right text-[10.5px] tabular-nums", zero ? "text-text-muted/70" : "text-text-muted")}>
              {total ? formatPercent(value / total) : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type RuleRateRow = {
  key: string;
  label: string;
  matched: number;
  evaluations: number;
  rate: number | null;
};

/** 命中率热度底色：强度只由命中率决定，颜色仍然只表达数值大小 */
function heatStyle(rate: number | null) {
  if (rate === null || !Number.isFinite(rate)) return { background: "var(--surface-subtle)" };
  const intensity = Math.round(8 + Math.min(Math.max(rate, 0), 1) * 32);
  return { background: `color-mix(in srgb, var(--color-interactive) ${intensity}%, white)` };
}

/**
 * 规则命中率表：规则名 + 命中/评估 + 热度命中率，最后一行是全部规则合计。
 * 呈现为分析表而不是图表，和排行榜、漏斗区分开。
 */
export function RuleRateTable({
  rows,
  total,
}: {
  rows: RuleRateRow[];
  total?: { matched: number; evaluations: number };
}) {
  if (!rows.length) return <VisualEmpty />;
  const totalRate = total && total.evaluations > 0 ? total.matched / total.evaluations : null;
  return (
    <table data-testid="visual-rule-rate-table" className="w-full border-collapse text-left">
      <thead>
        <tr className="text-[10px] text-text-muted">
          <th scope="col" className="pb-1.5 font-medium">规则</th>
          <th scope="col" className="w-[86px] pb-1.5 text-right font-medium">命中 / 评估</th>
          <th scope="col" className="w-[64px] pb-1.5 text-right font-medium">命中率</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/70">
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="max-w-0 py-1.5 pr-2">
              <span title={row.label} className="block truncate text-[11.5px] text-text-secondary">{row.label}</span>
            </td>
            <td className="py-1.5 pr-2 text-right text-[11px] tabular-nums text-text-muted">
              <span className="font-semibold text-text-primary">{row.matched}</span>
              <span className="px-0.5">/</span>
              <span>{row.evaluations}</span>
            </td>
            <td className="py-1.5 text-right">
              <span
                className="inline-flex h-5 min-w-[52px] items-center justify-center rounded-[4px] px-1.5 text-[11px] font-semibold tabular-nums text-text-primary"
                style={heatStyle(row.rate)}
              >
                {formatPercent(row.rate)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr className="border-t border-border-strong/70">
            <td className="pt-2 text-[11px] font-medium text-text-secondary">全部规则</td>
            <td className="pt-2 text-right text-[11px] tabular-nums text-text-muted">
              <span className="font-semibold text-text-primary">{total.matched}</span>
              <span className="px-0.5">/</span>
              <span>{total.evaluations}</span>
            </td>
            <td className="pt-2 text-right">
              <span
                className="inline-flex h-5 min-w-[52px] items-center justify-center rounded-[4px] px-1.5 text-[11px] font-semibold tabular-nums text-text-primary"
                style={heatStyle(totalRate)}
              >
                {formatPercent(totalRate)}
              </span>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/**
 * 来源占比：100% 分段条 + 图例。
 * 维度本身没有语义，因此使用分类色板而不是严重度色板。
 */
export function SourceShare({ data }: { data: CategoryDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <VisualEmpty />;
  return (
    <div data-testid="visual-source-share" className="space-y-3">
      <div className="flex h-3.5 w-full gap-[3px]">
        {data.map((item, index) => (
          <span
            key={item.key}
            title={`${item.label}：${item.value}`}
            className="h-full min-w-[3px] rounded-full"
            style={{
              flexGrow: item.value,
              flexBasis: 0,
              background: item.color ?? CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length],
            }}
          />
        ))}
      </div>
      <ul className="space-y-2">
        {data.map((item, index) => (
          <li key={item.key} className="flex items-center gap-2 text-[11.5px]">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: item.color ?? CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-text-secondary" title={item.label}>{item.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-text-primary">{item.value}</span>
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-text-muted">{formatPercent(item.value / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
