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
import { formatBusinessValue } from "../utils.js";

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
  return (
    <section className="border-b border-border bg-surface" aria-labelledby="digital-thread-title">
      <div className="mx-auto w-full max-w-[1720px] px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="digital-thread-title" className="text-sm font-semibold">履约数字线程</h2>
            <p className="mt-0.5 text-xs text-text-muted">连接仅表示业务顺序，不代表因果关系</p>
          </div>
          <p className="text-xs text-text-muted">
            {rules.length} 条规则评估 · {rules.filter((rule) => rule.matched).length} 命中 · {rules.filter((rule) => rule.status === "not_matched").length} 未命中
          </p>
        </div>
        <div className="mt-3 overflow-x-auto pb-1">
          <div className="flex min-w-max border-y border-border" role="list" aria-label="履约阶段">
            {stages.map((stage, index) => {
              const Icon = stageIcons[stage.key] ?? FileText;
              const stageRules = rules.filter((rule) => rule.stageKeys.includes(stage.key));
              return (
                <div key={stage.key} role="listitem">
                  <button
                    type="button"
                    data-testid="thread-stage"
                    aria-current={highlightedStage === stage.key ? "step" : undefined}
                    onClick={() => onStageSelect(stage)}
                    className={cn(
                      "relative h-full w-[184px] shrink-0 border-r border-border px-3 py-3 text-left transition-colors hover:bg-surface-muted",
                      index === 0 && "border-l",
                      stage.state === "exception" && "bg-warning/5",
                      highlightedStage === stage.key && "bg-interactive/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="size-4 text-text-muted" aria-hidden="true" />
                        {stage.label}
                      </span>
                      <span
                        className={cn("size-2 rounded-full bg-border-strong", stage.state === "exception" && "bg-warning")}
                        aria-label={stage.state === "exception" ? "存在异常" : "正常"}
                      />
                    </div>
                    <div className="mt-1 truncate text-xs text-text-muted">{stage.businessKey}</div>
                    <div className="mt-3 space-y-1.5">
                      {stage.facts.slice(0, 3).map((fact) => (
                        <div key={`${fact.key}-${fact.evidenceId}`} className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs text-text-muted">{fact.label}</span>
                          <strong className="shrink-0 text-sm font-semibold">{formatBusinessValue(fact)}</strong>
                        </div>
                      ))}
                      {!stage.facts.length && <div className="text-xs text-text-muted">暂无事实</div>}
                    </div>
                    {stageRules.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {stageRules.map((rule) => (
                          <Badge
                            key={rule.id}
                            data-testid="rule-chip"
                            data-rule-id={rule.id}
                            variant={rule.matched ? "warning" : "success"}
                            title={rule.code}
                            className="max-w-full truncate"
                          >
                            {rule.matched ? "!" : "✓"} {rule.label}
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
