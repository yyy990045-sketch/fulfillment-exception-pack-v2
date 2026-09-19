import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LocalState, ProductLoading, ProductPage } from "../../../components/product/page-layout.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs.js";
import { useWorkbenchView, useExceptionEvidence } from "../../../hooks/use-manufacturing.js";
import { ContextHeader } from "../components/context-header.js";
import { AnalysisWorkspace, DecisionWorkspace } from "../components/analysis-workspace.js";
import { DecisionProcessBar } from "../components/decision-process-bar.js";
import { DigitalThread } from "../components/digital-thread.js";
import { EvidenceInspector } from "../components/evidence-inspector.js";
import { EvidenceWorkspace } from "../components/evidence-workspace.js";
import { ExceptionOverview } from "../components/exception-overview.js";
import { ExceptionRail } from "../components/exception-rail.js";
import { GovernanceActionControllerProvider } from "../governance-action-controller.js";
import { SelectedExceptionHeader } from "../components/selected-exception-header.js";
import type { EvidenceItem, ExceptionView } from "../types.js";

function PageSkeleton() {
  return (
    <div data-testid="workbench-loading">
      <ProductLoading />
    </div>
  );
}

function LocalError({ title, detail }: { title: string; detail: string }) {
  return <div className="p-5"><LocalState kind="error" title={title} detail={detail} /></div>;
}

export function ManufacturingWorkbenchPage() {
  const { contextId = "ctx-so-mfg-001", exceptionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workbench = useWorkbenchView(contextId);
  const scrollPositions = useRef<Record<string, number>>({});
  const view = workbench.data;
  const selectedExceptionId = exceptionId ?? view?.defaultExceptionId ?? view?.exceptions[0]?.id;
  const selectedException = view?.exceptions.find((item) => item.id === selectedExceptionId);
  const workspaceTab = location.pathname.endsWith("/evidence")
    ? "evidence"
    : location.pathname.endsWith("/analysis")
      ? "analysis"
      : location.pathname.endsWith("/decision")
        ? "decision"
        : "overview";
  const scrollKey = `${selectedExceptionId ?? ""}:${workspaceTab}`;
  useLayoutEffect(() => {
    if (import.meta.env.MODE === "test") return;
    const target = scrollPositions.current[scrollKey] ?? 0;
    requestAnimationFrame(() => window.scrollTo({ top: target, behavior: "instant" }));
  }, [scrollKey]);
  const evidence = useExceptionEvidence(contextId, selectedException?.id);
  const selectedEvidenceId = searchParams.get("evidence") ?? undefined;
  const selectedEvidence = workspaceTab === "evidence"
    ? evidence.data?.evidence.find((item) => item.evidenceId === selectedEvidenceId)
    : undefined;

  if (workbench.isLoading) return <PageSkeleton />;
  if (workbench.isError || !view) {
    return <LocalError title="履约上下文加载失败" detail="当前 API 无法返回制造履约工作台。" />;
  }

  const highlightedStage = searchParams.get("stage") ?? undefined;

  const openException = (exception: ExceptionView) => {
    scrollPositions.current[scrollKey] = window.scrollY;
    const next = new URLSearchParams(searchParams);
    next.delete("evidence");
    next.delete("stage");
    const suffix = next.toString() ? `?${next.toString()}` : "";
    navigate(`/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exception.id)}${suffix}`);
  };
  const openStage = (stage: { entityId: string; key: string }) => {
    const related = view.exceptions.find((exception) =>
      exception.entityIds.includes(stage.entityId) || exception.stageKeys.includes(stage.key),
    );
    if (!related) return;
    scrollPositions.current[scrollKey] = window.scrollY;
    const next = new URLSearchParams(searchParams);
    next.delete("evidence");
    next.set("stage", stage.key);
    navigate(`/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(related.id)}?${next.toString()}`);
  };
  const setTab = (tab: string) => {
    if (!selectedException) return;
    scrollPositions.current[scrollKey] = window.scrollY;
    const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(selectedException.id)}`;
    const next = new URLSearchParams(searchParams);
    const suffix = next.toString() ? `?${next.toString()}` : "";
    if (tab === "evidence") return navigate(`${base}/evidence${suffix}`);
    if (tab === "analysis") return navigate(`${base}/analysis${suffix}`);
    if (tab === "decision") return navigate(`${base}/decision${suffix}`);
    return navigate(`${base}${suffix}`);
  };
  const openEvidenceById = (evidenceId: string) => {
    if (!selectedException) return;
    scrollPositions.current[scrollKey] = window.scrollY;
    const next = new URLSearchParams(searchParams);
    next.set("evidence", evidenceId);
    navigate(`/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(selectedException.id)}/evidence?${next.toString()}`);
  };
  const openEvidence = (item: EvidenceItem) => {
    openEvidenceById(item.evidenceId);
  };
  const closeEvidence = (open: boolean) => {
    if (open) return;
    const next = new URLSearchParams(searchParams);
    next.delete("evidence");
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <ContextHeader view={view} />
      <DigitalThread
        stages={view.thread}
        rules={view.rules}
        {...(highlightedStage ? { highlightedStage } : {})}
        onStageSelect={openStage}
      />
      <ProductPage>
        {!selectedException ? (
          <LocalError title="暂无异常" detail="当前履约上下文没有可展示的异常。" />
        ) : (
          <GovernanceActionControllerProvider
            contextId={contextId}
            exceptionId={selectedException.id}
            businessKey={view.context.businessKey}
            exceptionLabel={selectedException.label}
          >
            <div className="grid overflow-hidden border border-border bg-surface lg:grid-cols-[300px_minmax(0,1fr)]">
              <ExceptionRail
                exceptions={view.exceptions}
                resolutionCases={view.resolutionCases}
                stages={view.thread}
                selectedExceptionId={selectedException.id}
                onSelect={openException}
              />
              <section className="min-w-0">
                <SelectedExceptionHeader
                  exception={selectedException}
                  contextId={contextId}
                  context={view.context}
                  onNavigateTab={setTab}
                />
                <DecisionProcessBar contextId={contextId} exceptionId={selectedException.id} />
                <Tabs value={workspaceTab} onValueChange={setTab}>
                  <div className="px-4 pt-2 lg:px-5">
                    <TabsList aria-label="异常工作面">
                      <TabsTrigger value="overview">概览</TabsTrigger>
                      <TabsTrigger value="evidence">证据</TabsTrigger>
                      <TabsTrigger value="analysis">分析</TabsTrigger>
                      <TabsTrigger value="decision">决策</TabsTrigger>
                    </TabsList>
                  </div>
                  <div className="p-4 lg:p-5">
                    {workspaceTab === "evidence" ? (
                      evidence.isLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-9 w-full" />
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                        </div>
                      ) : evidence.isError || !evidence.data ? (
                        <LocalError title="证据加载失败" detail="当前异常暂时无法读取证据资料。" />
                      ) : (
                        <EvidenceWorkspace
                          bundle={evidence.data}
                          {...(selectedEvidenceId ? { selectedEvidenceId } : {})}
                          onSelect={openEvidence}
                        />
                      )
                    ) : workspaceTab === "analysis" ? (
                      <AnalysisWorkspace
                        contextId={contextId}
                        exceptionId={selectedException.id}
                        evidence={evidence.data}
                        onOpenEvidence={openEvidenceById}
                      />
                    ) : workspaceTab === "decision" ? (
                      <DecisionWorkspace
                        contextId={contextId}
                        exceptionId={selectedException.id}
                        evidence={evidence.data}
                        onOpenEvidence={openEvidenceById}
                      />
                    ) : (
                      <ExceptionOverview contextId={contextId} exception={selectedException} rules={view.rules} stages={view.thread} />
                    )}
                  </div>
                </Tabs>
              </section>
            </div>
          </GovernanceActionControllerProvider>
        )}
      </ProductPage>
      {evidence.data && (
        <EvidenceInspector
          bundle={evidence.data}
          item={selectedEvidence}
          open={Boolean(selectedEvidence)}
          onOpenChange={closeEvidence}
        />
      )}
    </>
  );
}
