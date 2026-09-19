import { AlertCircle } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs.js";
import { useWorkbenchView, useExceptionEvidence } from "../../../hooks/use-manufacturing.js";
import { ContextHeader } from "../components/context-header.js";
import { AnalysisWorkspace, DecisionWorkspace } from "../components/analysis-workspace.js";
import { DigitalThread } from "../components/digital-thread.js";
import { EvidenceInspector } from "../components/evidence-inspector.js";
import { EvidenceWorkspace } from "../components/evidence-workspace.js";
import { ExceptionOverview } from "../components/exception-overview.js";
import { ExceptionRail } from "../components/exception-rail.js";
import { SelectedExceptionHeader } from "../components/selected-exception-header.js";
import type { EvidenceItem, ExceptionView } from "../types.js";

function PageSkeleton() {
  return (
    <main data-testid="workbench-loading" className="mx-auto w-full max-w-[1720px] space-y-3 px-5 py-5">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </main>
  );
}

function LocalError({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="m-5 flex gap-3 border border-danger/25 bg-danger/5 p-4 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div>
        <div className="font-medium text-danger">{title}</div>
        <div className="mt-1 text-text-secondary">{detail}</div>
      </div>
    </div>
  );
}

export function ManufacturingWorkbenchPage() {
  const { contextId = "ctx-so-mfg-001", exceptionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workbench = useWorkbenchView(contextId);
  const view = workbench.data;
  const selectedExceptionId = exceptionId ?? view?.defaultExceptionId ?? view?.exceptions[0]?.id;
  const selectedException = view?.exceptions.find((item) => item.id === selectedExceptionId);
  const evidence = useExceptionEvidence(contextId, selectedException?.id);
  const selectedEvidenceId = searchParams.get("evidence") ?? undefined;
  const selectedEvidence = evidence.data?.evidence.find((item) => item.evidenceId === selectedEvidenceId);

  if (workbench.isLoading) return <PageSkeleton />;
  if (workbench.isError || !view) {
    return <LocalError title="履约上下文加载失败" detail="当前 API 无法返回制造履约工作台。" />;
  }

  const workspaceTab = location.pathname.endsWith("/evidence")
    ? "evidence"
    : location.pathname.endsWith("/analysis")
      ? "analysis"
      : location.pathname.endsWith("/decision")
        ? "decision"
        : "overview";
  const highlightedStage = searchParams.get("stage") ?? undefined;

  const openException = (exception: ExceptionView) => {
    navigate(`/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exception.id)}`);
  };
  const openStage = (stage: { entityId: string; key: string }) => {
    const related = view.exceptions.find((exception) =>
      exception.entityIds.includes(stage.entityId) || exception.stageKeys.includes(stage.key),
    );
    if (related) navigate(`/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(related.id)}?stage=${encodeURIComponent(stage.key)}`);
  };
  const setTab = (tab: string) => {
    if (!selectedException) return;
    const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(selectedException.id)}`;
    if (tab === "evidence") return navigate(`${base}/evidence`);
    if (tab === "analysis") return navigate(`${base}/analysis`);
    if (tab === "decision") return navigate(`${base}/decision`);
    return navigate(base);
  };
  const openEvidenceById = (evidenceId: string) => {
    if (!selectedException) return;
    const next = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(selectedException.id)}/evidence?evidence=${encodeURIComponent(evidenceId)}`;
    navigate(next);
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
      <main className="mx-auto w-full max-w-[1720px] px-5 py-4">
        {!selectedException ? (
          <LocalError title="暂无异常" detail="当前履约上下文没有可展示的异常。" />
        ) : (
          <div className="grid overflow-hidden border border-border bg-surface lg:grid-cols-[320px_minmax(0,1fr)]">
            <ExceptionRail
              exceptions={view.exceptions}
              selectedExceptionId={selectedException.id}
              onSelect={openException}
            />
            <section className="min-w-0">
              <SelectedExceptionHeader exception={selectedException} />
              <Tabs value={workspaceTab} onValueChange={setTab}>
                <div className="px-4 pt-2 lg:px-5">
                  <TabsList aria-label="异常工作面">
                    <TabsTrigger value="overview">概览</TabsTrigger>
                    <TabsTrigger value="evidence">证据</TabsTrigger>
                    <TabsTrigger value="analysis">分析</TabsTrigger>
                    <TabsTrigger value="decision">处置建议</TabsTrigger>
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
                      <LocalError title="证据加载失败" detail="当前异常暂时无法读取 Evidence。" />
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
                    <ExceptionOverview exception={selectedException} rules={view.rules} stages={view.thread} />
                  )}
                </div>
              </Tabs>
            </section>
          </div>
        )}
      </main>
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
