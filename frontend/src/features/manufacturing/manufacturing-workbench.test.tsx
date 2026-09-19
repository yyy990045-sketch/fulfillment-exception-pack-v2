import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../app/app-shell.js";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import {
  decisionFixture,
  decisionListFixture,
  evidenceBundleFixture,
  explanationFixture,
  explanationListFixture,
  rootCauseFixture,
  rootCauseListFixture,
  workbenchFixture,
} from "../../test/fixtures/manufacturing.js";
import { resolutionCapabilitiesFixture, resolutionQueryFixture } from "../../test/fixtures/governance.js";
import { ExceptionRecordPage } from "./pages/exception-record-page.js";
import { ManufacturingContextPage } from "./pages/manufacturing-context-page.js";
import type { EvidenceBundleView } from "./types.js";
import { businessFactLabel, governanceActionStatusLabel, sourceSystemLabel } from "./utils.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function mockApi(options: {
  workbench?: unknown;
  evidence?: EvidenceBundleView | unknown;
  explanationList?: unknown;
  explanation?: unknown;
  rootCauseList?: unknown;
  rootCause?: unknown;
  decisionList?: unknown;
  decision?: unknown;
  error?: boolean;
  analysisError?: boolean;
  explanationListError?: boolean;
  holdExplanationList?: boolean;
} = {}) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const pathname = new URL(String(input), window.location.origin).pathname;
    if (options.error) return jsonResponse({ error: "not_found" }, 500);
    if (pathname === "/api/v2/auth/context") {
      return jsonResponse({
        currentActor: {
          tenantId: "demo-manufacturing",
          organization: "示例制造企业",
          organizationSource: "demo",
          user: "品质负责人",
          subjectId: "demo-quality-owner",
          roles: ["品质负责人"],
          authnMethod: "demo-header",
        },
      });
    }
    if (options.analysisError && (
      pathname.includes("/explanations") ||
      pathname.includes("/root-cause-analyses") ||
      pathname.includes("/decision-recommendations")
    )) return jsonResponse({ error: "provider_failure" }, 500);
    if (pathname.endsWith("/workbench")) return jsonResponse(options.workbench ?? workbenchFixture);
    if (pathname.endsWith("/bundle")) return jsonResponse(options.evidence ?? evidenceBundleFixture);
    if (pathname.endsWith("/resolution-capabilities")) return jsonResponse(resolutionCapabilitiesFixture());
    if (pathname.endsWith("/resolution-cases")) {
      return jsonResponse({ contextId: "ctx-fixture", resolutionCases: workbenchFixture.resolutionCases });
    }
    if (pathname.endsWith("/resolution-cases/resolution-claim")) return jsonResponse(resolutionQueryFixture("triaged"));
    if (pathname.endsWith("/policy-evaluations")) return jsonResponse({ contextId: "ctx-fixture", exceptionId: "exception-claim", evaluations: [] });
    if (pathname.endsWith("/outcome-evaluations")) return jsonResponse({ contextId: "ctx-fixture", exceptionId: "exception-claim", evaluations: [] });
    if (pathname.endsWith("/explanations")) {
      if (options.holdExplanationList) return new Promise(() => {});
      if (options.explanationListError) return jsonResponse({ error: "explanation_unavailable" }, 500);
      return jsonResponse(options.explanationList ?? explanationListFixture);
    }
    if (pathname.includes("/explanations/")) return jsonResponse(options.explanation ?? explanationFixture);
    if (pathname.endsWith("/root-cause-analyses")) return jsonResponse(options.rootCauseList ?? rootCauseListFixture);
    if (pathname.includes("/root-cause-analyses/")) return jsonResponse(options.rootCause ?? rootCauseFixture);
    if (pathname.endsWith("/decision-recommendations")) return jsonResponse(options.decisionList ?? decisionListFixture);
    if (pathname.includes("/decision-recommendations/")) return jsonResponse(options.decision ?? decisionFixture);
    return jsonResponse({});
  }));
}

function renderAt(initialEntry: string, options: { resetHistory?: boolean } = {}) {
  if (options.resetHistory !== false) window.history.replaceState({}, "", initialEntry);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/manufacturing/ctx-so-mfg-001" replace />} />
              <Route path="/manufacturing/:contextId" element={<ManufacturingContextPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId" element={<ExceptionRecordPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/overview" element={<ExceptionRecordPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/evidence" element={<ExceptionRecordPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/analysis" element={<ExceptionRecordPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/decision" element={<ExceptionRecordPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/governance" element={<ExceptionRecordPage />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </DemoSettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Manufacturing information architecture", () => {
  it("renders local loading and error states for the context page", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderAt("/manufacturing/ctx-fixture");
    expect(screen.getByTestId("workbench-loading")).toBeInTheDocument();
    cleanup();

    mockApi({ error: true });
    renderAt("/manufacturing/ctx-fixture");
    expect(await screen.findByText("履约上下文加载失败")).toBeInTheDocument();
  });

  it("keeps the Context Page focused on finding exceptions", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture");

    expect(await screen.findByRole("heading", { name: "SO-FIXTURE-001" })).toBeInTheDocument();
    expect(screen.getAllByTestId("thread-stage")).toHaveLength(8);
    expect(screen.getByTestId("exception-queue-table")).toBeInTheDocument();
    expect(screen.getAllByTestId("exception-item")).toHaveLength(4);
    expect(screen.queryByTestId("selected-exception-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("evidence-row")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI 解释" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理进程" })).not.toBeInTheDocument();
  });

  it("filters and sorts the queue and preserves filters when opening an exception", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });

    await user.type(screen.getByLabelText("搜索异常"), "回款");
    expect(screen.getAllByTestId("exception-item")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /回款未结清/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/manufacturing/ctx-fixture/exceptions/exception-payment/overview"));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("回款");
    expect(screen.queryByTestId("exception-queue-table")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "回款未结清" })).toBeInTheDocument();
  });

  it("returns from an exception to the filtered queue with browser Back", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture?q=回款");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });
    expect(screen.getAllByTestId("exception-item")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /回款未结清/ }));
    await screen.findByRole("heading", { name: "回款未结清" });
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/manufacturing/ctx-fixture"));
    expect(screen.getByLabelText("搜索异常")).toHaveValue("回款");
    expect(screen.getAllByTestId("exception-item")).toHaveLength(1);
  });

  it("keeps Overview focused on understanding the exception", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/overview");

    expect(await screen.findByRole("heading", { name: "客户签收主张差异" })).toBeInTheDocument();
    expect(screen.getByText("核心差异")).toBeInTheDocument();
    expect(screen.getByText("当前事实")).toBeInTheDocument();
    expect(screen.getByText("待核实内容")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看证据" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看分析" })).toBeInTheDocument();
    expect(screen.queryByTestId("evidence-row")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理进程" })).not.toBeInTheDocument();
  });

  it("navigates from the header primary action to the Governance route", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/overview");
    await screen.findByRole("heading", { name: "客户签收主张差异" });

    await user.click(await screen.findByRole("link", { name: "进入治理" }));
    await waitFor(() => expect(window.location.pathname).toBe("/manufacturing/ctx-fixture/exceptions/exception-claim/governance"));
    expect(await screen.findByRole("heading", { name: "处理进程" })).toBeInTheDocument();
  });

  it("keeps Evidence focused on facts only", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/evidence");
    expect(await screen.findAllByTestId("evidence-row")).toHaveLength(2);
    expect(screen.getByLabelText("搜索证据")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI 解释" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "决策建议" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理进程" })).not.toBeInTheDocument();
  });

  it("keeps Analysis focused on understanding causes", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    expect(await screen.findByRole("heading", { name: "AI 解释" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "根因假设" })).toBeInTheDocument();
    expect(screen.getByText("已知事实")).toBeInTheDocument();
    expect(screen.getByText("待核实事项")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理进程" })).not.toBeInTheDocument();
  });

  it("keeps Decision focused on choosing a plan and links to Governance", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/decision");
    expect(await screen.findByRole("heading", { name: "决策建议" })).toBeInTheDocument();
    expect(screen.getByText("补充签收证据")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理进程" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "进入治理" }).every((link) => link.getAttribute("href") === (
      "/manufacturing/ctx-fixture/exceptions/exception-claim/governance"
    ))).toBe(true);
  });

  it("renders Governance as the only expanded current-step work surface", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/governance");
    expect(await screen.findByRole("heading", { name: "处理进程" })).toBeInTheDocument();
    expect(screen.getAllByText("当前阶段").length).toBeGreaterThan(0);
    expect(screen.getByText("负责人")).toBeInTheDocument();
    expect(screen.getByText("当前方案")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "决策建议" })).not.toBeInTheDocument();
  });

  it("supports Evidence deep links and closes the Inspector", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/evidence?evidence=evidence-claim");
    expect(await screen.findByTestId("evidence-inspector")).toHaveTextContent("Evidence ID");
    const close = screen.getByRole("button", { name: "关闭" });
    await userEvent.setup().click(close);
    await waitFor(() => expect(screen.queryByTestId("evidence-inspector")).not.toBeInTheDocument());
  });

  it("keeps analysis errors local and preserves empty analysis states", async () => {
    mockApi({ analysisError: true });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    expect(await screen.findByText("AI 解释加载失败")).toBeInTheDocument();
    expect(screen.getByText("根因假设加载失败")).toBeInTheDocument();
    cleanup();

    mockApi({
      explanationList: { contextId: "ctx-fixture", exceptionId: "exception-claim", explanations: [] },
      rootCauseList: { contextId: "ctx-fixture", exceptionId: "exception-claim", analyses: [] },
    });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    await waitFor(() => expect(screen.getAllByText("暂无生成结果")).toHaveLength(2));
  });

  it("uses Chinese business labels for governance actions, facts, and source systems", () => {
    expect(governanceActionStatusLabel("draft")).toBe("方案草稿");
    expect(governanceActionStatusLabel("pending_approval")).toBe("待审批");
    expect(businessFactLabel("qty")).toBe("数量");
    expect(businessFactLabel("internalRiskFlag")).toBe("业务事实");
    expect(sourceSystemLabel("manual", "Service Demo")).toBe("人工记录");
    expect(sourceSystemLabel("service", "Service")).toBe("客户服务记录");
    expect(sourceSystemLabel("wms", "WMS Demo")).toBe("仓储系统");
  });
});
