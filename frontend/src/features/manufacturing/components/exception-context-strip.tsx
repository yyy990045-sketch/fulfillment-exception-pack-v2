import { ArrowRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { ExceptionView, ThreadStage } from "../types.js";
import { formatBusinessValue } from "../utils.js";

export function ExceptionContextStrip({
  contextId,
  exception,
  stages,
}: {
  contextId: string;
  exception: ExceptionView;
  stages: ThreadStage[];
}) {
  const [searchParams] = useSearchParams();
  const related = exception.stageKeys.flatMap((key) => {
    const stage = stages.find((item) => item.key === key);
    return stage ? [stage] : [];
  });
  const next = new URLSearchParams(searchParams);
  if (exception.stageKeys[0]) next.set("stageKey", exception.stageKeys[0]);
  const contextHref = `/manufacturing/${encodeURIComponent(contextId)}${next.toString() ? `?${next.toString()}` : ""}`;
  return (
    <section className="border-b border-border bg-surface-muted/40">
      <div className="mx-auto flex w-full max-w-[1720px] flex-wrap items-center gap-3 px-5 py-3">
        <span className="text-xs font-medium text-text-muted">相关链路</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {related.map((stage, index) => {
            const fact = stage.facts[0];
            return (
              <div key={stage.key} className="flex items-center gap-2">
                {index > 0 && <ArrowRight className="size-3.5 text-text-muted" aria-hidden="true" />}
                <span className="text-xs text-text-secondary">
                  {stage.label}
                  {fact && <> <strong className="font-semibold text-text-primary">{formatBusinessValue(fact)}</strong></>}
                </span>
              </div>
            );
          })}
        </div>
        <Link
          to={contextHref}
          className="text-xs font-medium text-interactive hover:underline"
        >
          查看完整履约链路
        </Link>
      </div>
    </section>
  );
}
