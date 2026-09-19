import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LocalState, ProductLoading, ProductPage } from "../../../components/product/page-layout.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import {
  useDecisionRecommendation,
  useExceptionEvidence,
  useWorkbenchView,
} from "../../../hooks/use-manufacturing.js";
import { AnalysisWorkspace, DecisionWorkspace } from "../components/analysis-workspace.js";
import { EvidenceInspector } from "../components/evidence-inspector.js";
import { EvidenceWorkspace } from "../components/evidence-workspace.js";
import { ExceptionContextStrip } from "../components/exception-context-strip.js";
import { ExceptionOverview } from "../components/exception-overview.js";
import { ExceptionRecordHeader } from "../components/exception-record-header.js";
import { ExceptionRecordNav } from "../components/exception-record-nav.js";
import { GovernanceProcess } from "../components/governance-process.js";
import { GovernanceActionControllerProvider } from "../governance-action-controller.js";

type RecordSection = "overview" | "evidence" | "analysis" | "decision" | "governance";

function recordSection(pathname: string): RecordSection | undefined {
  if (pathname.endsWith("/overview")) return "overview";
  if (pathname.endsWith("/evidence")) return "evidence";
  if (pathname.endsWith("/analysis")) return "analysis";
  if (pathname.endsWith("/decision")) return "decision";
  if (pathname.endsWith("/governance")) return "governance";
  return undefined;
}

export function ExceptionRecordPage() {
  const { contextId = "", exceptionId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workbench = useWorkbenchView(contextId);
  const evidence = useExceptionEvidence(contextId, exceptionId);
  const decision = useDecisionRecommendation(contextId, exceptionId);
  const section = recordSection(location.pathname);
  const view = workbench.data;
  const exception = view?.exceptions.find((item) => item.id === exceptionId);
  const selectedEvidenceId = searchParams.get("evidence") ?? undefined;
  const selectedEvidence = section === "evidence"
    ? evidence.data?.evidence.find((item) => item.evidenceId === selectedEvidenceId)
    : undefined;

  if (workbench.isLoading) return <ProductLoading />;
  if (workbench.isError || !view) {
    return (
      <ProductPage className="py-5">
        <LocalState kind="error" title="异常记录加载失败" detail="当前 API 无法返回异常记录。" />
      </ProductPage>
    );
  }
  if (!exception) {
    return (
      <ProductPage className="py-5">
        <LocalState kind="empty" title="未找到该异常" detail="异常可能已被移除或不属于当前业务上下文。" />
      </ProductPage>
    );
  }
  if (!section) {
    const query = searchParams.toString();
    return <Navigate to={`/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}/overview${query ? `?${query}` : ""}`} replace />;
  }

  const base = `/manufacturing/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;
  const openEvidence = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("evidence", id);
    navigate(`${base}/evidence?${next.toString()}`);
  };
  const closeEvidence = (open: boolean) => {
    if (open) return;
    const next = new URLSearchParams(searchParams);
    next.delete("evidence");
    setSearchParams(next, { replace: true });
  };
  const recommendation = decision.detail.data;
  const selectedOptionId = searchParams.get("option") ?? recommendation?.output.recommendedOptionId;

  return (
    <GovernanceActionControllerProvider
      contextId={contextId}
      exceptionId={exception.id}
      businessKey={view.context.businessKey}
      exceptionLabel={exception.label}
    >
      <ExceptionRecordHeader
        exception={exception}
        contextId={contextId}
        context={view.context}
        showPrimaryAction={section !== "decision" && section !== "governance"}
      />
      <ExceptionContextStrip contextId={contextId} exception={exception} stages={view.thread} />
      <ExceptionRecordNav contextId={contextId} exceptionId={exception.id} />
      <ProductPage>
        {section === "overview" ? (
          <ExceptionOverview contextId={contextId} exception={exception} rules={view.rules} stages={view.thread} />
        ) : section === "evidence" ? (
          evidence.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : evidence.isError || !evidence.data ? (
            <LocalState kind="error" title="证据加载失败" detail="当前异常暂时无法读取证据资料。" />
          ) : (
            <EvidenceWorkspace
              bundle={evidence.data}
              {...(selectedEvidenceId ? { selectedEvidenceId } : {})}
              onSelect={(item) => openEvidence(item.evidenceId)}
            />
          )
        ) : section === "analysis" ? (
          <AnalysisWorkspace
            contextId={contextId}
            exceptionId={exception.id}
            evidence={evidence.data}
            onOpenEvidence={openEvidence}
          />
        ) : section === "decision" ? (
          <DecisionWorkspace
            contextId={contextId}
            exceptionId={exception.id}
            evidence={evidence.data}
            onOpenEvidence={openEvidence}
          />
        ) : (
          <GovernanceProcess
            contextId={contextId}
            exceptionId={exception.id}
            recommendation={recommendation}
            selectedOptionId={selectedOptionId}
          />
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
    </GovernanceActionControllerProvider>
  );
}
