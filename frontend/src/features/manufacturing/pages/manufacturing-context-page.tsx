import { useLayoutEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LocalState, ProductLoading, ProductPage } from "../../../components/product/page-layout.js";
import { useWorkbenchView } from "../../../hooks/use-manufacturing.js";
import { ContextHeader } from "../components/context-header.js";
import { DigitalThread } from "../components/digital-thread.js";
import { ExceptionQueueTable } from "../components/exception-queue-table.js";
import type { ExceptionView } from "../types.js";

function queueScrollKey(contextId: string) {
  return `manufacturing:queue-scroll:${contextId}`;
}

export function ManufacturingContextPage() {
  const { contextId = "ctx-so-mfg-001" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workbench = useWorkbenchView(contextId);
  const queueRef = useRef<HTMLDivElement>(null);
  const view = workbench.data;

  useLayoutEffect(() => {
    if (import.meta.env.MODE === "test") return;
    if (!view) return;
    const key = queueScrollKey(contextId);
    const saved = Number(window.sessionStorage.getItem(key) ?? "0");
    if (!saved) return;
    window.sessionStorage.removeItem(key);
    requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: "instant" }));
  }, [contextId, view]);

  if (workbench.isLoading) {
    return <div data-testid="workbench-loading"><ProductLoading /></div>;
  }
  if (workbench.isError || !view) {
    return (
      <ProductPage className="py-5">
        <LocalState kind="error" title="履约上下文加载失败" detail="当前 API 无法返回制造履约工作台。" />
      </ProductPage>
    );
  }

  const openException = (exception: ExceptionView) => {
    window.sessionStorage.setItem(queueScrollKey(contextId), String(window.scrollY));
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    navigate(`/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exception.id)}/overview${suffix}`);
  };

  const selectStage = (stage: { key: string }) => {
    const next = new URLSearchParams(searchParams);
    next.set("stageKey", stage.key);
    setSearchParams(next, { replace: true });
    requestAnimationFrame(() => queueRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <>
      <ContextHeader view={view} />
      <DigitalThread
        stages={view.thread}
        rules={view.rules}
        highlightedStage={searchParams.get("stageKey") ?? undefined}
        onStageSelect={selectStage}
      />
      <ProductPage>
        <div ref={queueRef}>
          <ExceptionQueueTable
            exceptions={view.exceptions}
            stages={view.thread}
            onOpen={openException}
          />
        </div>
      </ProductPage>
    </>
  );
}
