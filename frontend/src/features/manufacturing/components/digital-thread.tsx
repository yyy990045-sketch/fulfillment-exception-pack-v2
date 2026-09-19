import {
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
import { Badge } from "../../../components/ui/badge.js";
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
    <section className="border-b border-border bg-surface" aria-labelledby="digital-thread-title">
      <div className="mx-auto w-full max-w-[1720px] px-5 py-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
          <h2 id="digital-thread-title" className="text-sm font-semibold">履约数字线程</h2>
          <p className="mt-0.5 text-xs text-text-muted">连接仅表示业务顺序，不代表因果关系</p>
        </div>
        <p className="text-xs text-text-muted">
            {rules.length} 条唯一规则评估 · {rules.filter((rule) => rule.matched).length} 命中 · {rules.filter((rule) => rule.status === "not_matched").length} 未命中
        </p>
      </div>
      <div className="mt-2.5 overflow-x-auto pb-1">
          <div
            data-testid="digital-thread-track"
            className="grid min-w-[1180px] grid-cols-8 border-y border-border"
            role="list"
            aria-label="履约阶段"
          >
            {stages.map((stage, index) => {
              const Icon = stageIcons[stage.key] ?? FileText;
              const fact = primaryFact(stage);
              const stageRules = stage.state === "exception"
                ? rules
                    .filter((rule) => rule.matched && rule.stageKeys.includes(stage.key) && !visibleRuleIds.has(rule.id))
                    .slice(0, 1)
                : [];
              for (const rule of stageRules) visibleRuleIds.add(rule.id);
              return (
                <div key={stage.key} role="listitem">
                  <button
                    type="button"
                    data-testid="thread-stage"
                    title={`${stage.label} · ${stage.businessKey}`}
                    aria-current={highlightedStage === stage.key ? "step" : undefined}
                    onClick={() => onStageSelect(stage)}
                    className={cn(
                      "relative h-full w-full border-r border-border px-3 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-interactive/40",
                      index === 0 && "border-l",
                      stage.state === "exception" && "bg-warning/5",
                      stage.state === "normal" && "text-text-secondary",
                      highlightedStage === stage.key && "bg-interactive/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon
                          className={cn("size-4", stage.state === "normal" ? "text-border-strong" : "text-text-muted")}
                          aria-hidden="true"
                        />
                        {stage.label}
                      </span>
                      <span
                        className={cn("size-2 rounded-full bg-border-strong", stage.state === "exception" && "bg-warning")}
                        title={stage.state === "exception" ? "存在异常" : "正常"}
                        aria-label={stage.state === "exception" ? "存在异常" : "正常"}
                      />
                    </div>
                    <div className="mt-2.5">
                      {fact ? (
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs text-text-muted">{fact.label}</span>
                          <strong className="shrink-0 text-sm font-semibold">{formatBusinessValue(fact)}</strong>
                        </div>
                      ) : <div className="text-xs text-text-muted">暂无核心事实</div>}
                    </div>
                    {stageRules.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {stageRules.map((rule) => (
                          <Badge
                            key={rule.id}
                            data-testid="rule-chip"
                            data-rule-id={rule.id}
                            variant={rule.matched ? "warning" : "success"}
                            title={`${rule.code} · ${rule.label}`}
                            className="max-w-full truncate"
                          >
                            {exceptionBadgeLabel(rule.code)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
