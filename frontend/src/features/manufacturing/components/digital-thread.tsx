import {
  ChevronRight,
  CircleDollarSign,
  Factory,
  FileText,
  MessageSquareWarning,
  Package,
  ShieldCheck,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { productWidthClass } from "../../../components/product/page-layout.js";
import { cn } from "../../../lib/utils.js";
import type { RuleView, ThreadStage } from "../types.js";
import { exceptionBadgeLabel, formatBusinessValue } from "../utils.js";

const stageIcons: Record<string, LucideIcon> = {
  quote: FileText,
  sales_order: Package,
  production_order: Factory,
  quality_event: ShieldCheck,
  shipment: Truck,
  receivable: CircleDollarSign,
  payment: Wallet,
  complaint: MessageSquareWarning,
};

const primaryFactKeys: Partial<Record<string, string>> = {
  production_order: "completedQty",
  quality_event: "failedQty",
};

function primaryFact(stage: ThreadStage) {
  const preferred = primaryFactKeys[stage.key];
  return stage.facts.find((fact) => fact.key === preferred) ?? stage.facts[0];
}

export function DigitalThread({
  stages,
  rules,
  highlightedStage,
  onStageSelect,
}: {
  stages: ThreadStage[];
  rules: RuleView[];
  highlightedStage?: string;
  onStageSelect: (stage: ThreadStage) => void;
}) {
  const visibleRuleIds = new Set<string>();
  return (
    <section className="border-b border-border/80 bg-surface" aria-labelledby="digital-thread-title">
      <div className={`${productWidthClass} py-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="digital-thread-title" className="text-[14px] font-semibold">履约数字线程</h2>
            <p className="mt-0.5 text-[11px] text-text-muted">连接仅表示业务顺序，不代表因果关系</p>
          </div>
          <p className="text-[11px] text-text-muted">
            {rules.length} 条唯一规则评估 · {rules.filter((rule) => rule.matched).length} 命中 · {rules.filter((rule) => rule.status === "not_matched").length} 未命中
          </p>
        </div>
        <div className="mt-2.5 overflow-x-auto pb-1">
          <div
            data-testid="digital-thread-track"
            className="flex min-w-[1180px] items-stretch border-y border-border/60"
            role="list"
            aria-label="履约阶段"
          >
            {stages.map((stage, index) => {
              const Icon = stageIcons[stage.key] ?? FileText;
              const fact = primaryFact(stage);
              const stageRule = stage.state === "exception"
                ? rules.find((rule) => rule.matched && rule.stageKeys.includes(stage.key) && !visibleRuleIds.has(rule.id))
                : undefined;
              if (stageRule) visibleRuleIds.add(stageRule.id);
              return (
                <Fragment key={stage.key}>
                  {index > 0 && (
                    <div className="flex w-5 shrink-0 items-center justify-center text-border-strong" aria-hidden="true">
                      <ChevronRight className="size-4" />
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="thread-stage"
                    title={`${stage.label} · ${stage.businessKey}`}
                    aria-current={highlightedStage === stage.key ? "step" : undefined}
                    onClick={() => onStageSelect(stage)}
                    className={cn(
                      "min-w-[128px] flex-1 border-r border-border/55 px-3 py-2.5 text-left transition-all duration-150 hover:bg-surface-subtle/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-interactive/35 last:border-r-0",
                      stage.state === "normal" && "opacity-65",
                      highlightedStage === stage.key && "bg-interactive/[0.04] opacity-100",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium">
                        <Icon className={cn("size-3.5", stage.state === "exception" ? "text-warning" : "text-text-muted")} aria-hidden="true" />
                        <span className="truncate">{stage.label}</span>
                      </span>
                      <span
                        className={cn("size-1.5 rounded-full bg-border-strong", stage.state === "exception" && "bg-warning")}
                        aria-label={stage.state === "exception" ? "存在异常" : "正常"}
                      />
                    </div>
                    <div className="mt-2">
                      {fact ? (
                        <>
                          <strong className={cn(
                            "block text-[20px] font-semibold leading-7 tabular-nums",
                            stage.state === "exception" && "text-warning",
                          )}>{formatBusinessValue(fact)}</strong>
                          <span className="mt-0.5 block truncate text-[11px] text-text-muted">{fact.label}</span>
                        </>
                      ) : <span className="text-[11px] text-text-muted">暂无核心事实</span>}
                    </div>
                    {stageRule && (
                      <span
                        data-testid="rule-chip"
                        data-rule-id={stageRule.id}
                        title={`${stageRule.code} · ${stageRule.label}`}
                        className="mt-2 block truncate text-[11px] font-medium text-warning"
                      >
                        {exceptionBadgeLabel(stageRule.code)}
                      </span>
                    )}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
