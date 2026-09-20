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
  critical: "#a32118",
  high: "#c2410c",
  medium: "#b7791f",
  low: "#9a9a92",
};

export const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

/** 分类色板：用于来源系统这类本身无语义的维度，只保证维度内可区分 */
export const CATEGORICAL_COLORS = [
  "#5f6259",
  "#9c8a7b",
  "#6f6f6b",
  "#a19a90",
  "#7d8570",
  "#8b8175",
  "#4f5a4a",
  "#8a7d70",
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
        "flex items-center gap-3 rounded-lg border bg-surface px-3.5 py-3 text-left transition-colors duration-150",
        active ? "border-interactive/60 ring-1 ring-interactive/20" : "border-border hover:border-border-strong",
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
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-surface", className)}
    >
      <header className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold leading-[18px]">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-[11.5px] leading-4 text-text-muted">{subtitle}</p>}
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
 * 数值是否存在真实差异：没有差异时长度条会失去意义，不能靠视觉假装有排序。
 */
export function hasValueSpread(data: CategoryDatum[]) {
  if (data.length < 2) return false;
  const values = data.map((item) => item.value);
  return Math.max(...values) > Math.min(...values);
}

/**
 * 排行榜条：排名序号 + 类型名 + 长度条 + 数量。
 * 只用于「异常类型排行」一处；第一名用实心石墨强调，不给前三名做奖牌色。
 * 数量完全相同（无差异）时不画长度条，只保留极细基线。
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
  const spread = hasValueSpread(data);
  return (
    <ol data-testid="visual-ranking-bars" className="space-y-0.5">
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
                "group grid w-full grid-cols-[18px_minmax(0,1fr)_76px_26px] items-center gap-2.5 rounded-md py-2.5 text-left transition-colors",
                onSelect && "cursor-pointer",
              )}
            >
              <span className={cn(
                "flex size-[18px] items-center justify-center rounded-[4px] text-[10.5px] font-semibold tabular-nums",
                rank === 1 ? "bg-interactive text-white" : "bg-surface-subtle text-text-secondary",
              )}>
                {rank}
              </span>
              <span
                title={item.label}
                className={cn(
                  "line-clamp-2 min-w-0 text-[11.5px] leading-4 transition-colors",
                  active ? "font-medium text-interactive" : "text-text-secondary group-hover:text-text-primary",
                )}
              >
                {item.label}
              </span>
              <span className="flex items-center">
                {spread ? (
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
                    <span
                      className="block h-full rounded-full transition-all duration-200"
                      style={{
                        width: `${Math.max((item.value / max) * 100, 3)}%`,
                        background: item.color ?? (active ? "var(--color-interactive)" : "color-mix(in srgb, var(--color-interactive) 62%, white)"),
                      }}
                    />
                  </span>
                ) : (
                  <span className="h-px w-full bg-border" aria-hidden="true" />
                )}
              </span>
              <span className="text-right text-[12px] font-semibold tabular-nums text-text-primary">{item.value}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 阶段漏斗：自上而下逐级缩进 + 按真实值收窄，表达治理流程的阶段推进。
 * 值为 0 的阶段只留一小段短痕，绝不画成有长度的条形，让断崖一眼可见。
 */
export function StageFunnel({ data }: { data: CategoryDatum[] }) {
  if (!data.length) return <VisualEmpty />;
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <ol data-testid="visual-stage-funnel" className="space-y-0.5">
      {data.map((item, index) => {
        const value = Math.max(item.value, 0);
        const zero = value === 0;
        const width = Math.max((value / max) * 100, 0);
        return (
          <li key={item.key} className="grid grid-cols-[100px_minmax(0,1fr)_20px] items-center gap-2 py-[3px]">
            <span
              title={item.label}
              className={cn("min-w-0 truncate text-[11.5px]", zero ? "text-text-muted" : "text-text-secondary")}
            >
              {item.label}
            </span>
            <span className="flex h-5 items-center" style={{ paddingLeft: index * 5 }}>
              {zero ? (
                <span className="h-[3px] w-2.5 rounded-full bg-border-strong" aria-hidden="true" />
              ) : (
                <span
                  className="block h-full rounded-[3px] bg-interactive transition-all duration-200"
                  style={{ width: `${width}%` }}
                />
              )}
            </span>
            <span className={cn("text-right text-[11.5px] tabular-nums", zero ? "text-text-muted" : "font-semibold text-text-primary")}>
              {value}
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

/** 命中率热度底色：只用中性灰的深浅表达数值，不引入语义色 */
function heatStyle(rate: number | null) {
  if (rate === null || !Number.isFinite(rate)) return { background: "var(--surface-subtle)" };
  const intensity = Math.round(6 + Math.min(Math.max(rate, 0), 1) * 46);
  return { background: `color-mix(in srgb, var(--color-interactive) ${intensity}%, white)` };
}

/**
 * 规则命中率表：规则名 + 热度命中率单元格 + 命中/评估，最后一行是全部规则合计。
 * 是分析表而不是条形图；命中率用单元格底色表达，不再使用横向进度条。
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
        <tr className="text-[10.5px] text-text-muted">
          <th scope="col" className="pb-1.5 font-medium">规则</th>
          <th scope="col" className="w-[68px] pb-1.5 text-right font-medium">命中率</th>
          <th scope="col" className="w-[78px] pb-1.5 text-right font-medium">命中 / 评估</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-border">
            <td className="max-w-0 py-2 pr-2">
              <span title={row.label} className="block truncate text-[11.5px] text-text-secondary">{row.label}</span>
            </td>
            <td className="px-1.5 py-2 text-right text-[11.5px] font-semibold tabular-nums text-text-primary" style={heatStyle(row.rate)}>
              {formatPercent(row.rate)}
            </td>
            <td className="py-2 text-right text-[11.5px] tabular-nums text-text-muted">
              {row.rate === null ? (
                "—"
              ) : (
                <>
                  <span className="text-text-secondary">{row.matched}</span>
                  <span className="px-0.5">/</span>
                  <span>{row.evaluations}</span>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr className="border-t border-border-strong/70">
            <td className="pt-2 pr-2 text-[11.5px] font-medium text-text-secondary">全部规则</td>
            <td className="px-1.5 pt-2 text-right text-[11.5px] font-semibold tabular-nums text-text-primary" style={heatStyle(totalRate)}>
              {formatPercent(totalRate)}
            </td>
            <td className="pt-2 text-right text-[11.5px] tabular-nums text-text-muted">
              <span className="text-text-secondary">{total.matched}</span>
              <span className="px-0.5">/</span>
              <span>{total.evaluations}</span>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/**
 * 来源构成：分段环形图 + 图例（数量与占比都从真实数据计算）。
 * 与严重度环形图的区别：环更细、有分段间隙、中心不放合计数字。
 * 维度没有语义，使用低饱和的无蓝色分类色板。
 */
export function SourceComposition({ data }: { data: CategoryDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <VisualEmpty />;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const gap = data.length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <div data-testid="visual-source-composition" className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 100 100" className="size-[120px] shrink-0 -rotate-90" role="img" aria-label="来源系统占比">
        <circle cx={50} cy={50} r={radius} fill="none" stroke="var(--surface-subtle)" strokeWidth={9} />
        {data.map((item, index) => {
          const share = item.value / total;
          const length = Math.max(share * circumference - gap, 1);
          const element = (
            <circle
              key={item.key}
              cx={50}
              cy={50}
              r={radius}
              fill="none"
              stroke={item.color ?? CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]}
              strokeWidth={9}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            >
              <title>{`${item.label}：${item.value}`}</title>
            </circle>
          );
          offset += share * circumference;
          return element;
        })}
      </svg>
      <ul className="w-full min-w-0 space-y-2">
        {data.map((item, index) => (
          <li key={item.key} className="flex items-center gap-2 text-[11.5px]">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: item.color ?? CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-text-secondary" title={item.label}>{item.label}</span>
            <span className="shrink-0 text-right font-semibold tabular-nums text-text-primary">{item.value}</span>
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-text-muted">{formatPercent(item.value / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
