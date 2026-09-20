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
import { policyListFixture, resolutionCapabilitiesFixture, resolutionQueryFixture } from "../../test/fixtures/governance.js";
import { ExceptionRecordPage } from "./pages/exception-record-page.js";
import { ManufacturingContextPage } from "./pages/manufacturing-context-page.js";
import type { EvidenceBundleView } from "./types.js";
import { actionTypeLabel, businessFactLabel, governanceActionStatusLabel, sourceSystemLabel } from "./utils.js";

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
  policyList?: unknown;
  capabilities?: unknown;
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
    if (pathname.endsWith("/resolution-capabilities")) return jsonResponse(options.capabilities ?? resolutionCapabilitiesFixture());
    if (pathname.endsWith("/resolution-cases")) {
      return jsonResponse({ contextId: "ctx-fixture", resolutionCases: workbenchFixture.resolutionCases });
    }
    if (pathname.endsWith("/resolution-cases/resolution-claim")) return jsonResponse(resolutionQueryFixture("triaged"));
    if (pathname.endsWith("/policy-evaluations")) return jsonResponse(options.policyList ?? { contextId: "ctx-fixture", exceptionId: "exception-claim", evaluations: [] });
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
    expect(await screen.findByRole("heading", { name: "建议处理" })).toBeInTheDocument();
    expect(screen.getByText("补充签收证据")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理进程" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "进入治理" }).every((link) => link.getAttribute("href") === (
      "/manufacturing/ctx-fixture/exceptions/exception-claim/governance"
    ))).toBe(true);
  });

  it("shows AI signal, authoritative Policy, evidence, and backend disabled reasons", async () => {
    mockApi({
      policyList: policyListFixture("approval_required"),
      capabilities: resolutionCapabilitiesFixture({
        status: "triaged",
        overrides: {
          canReview: {
            applicable: true,
            allowed: false,
            reasonCode: "ROLE_NOT_ALLOWED",
            reason: "你没有复核权限",
          },
        },
      }),
    });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/decision");

    expect(await screen.findByRole("heading", { name: "智能判断" })).toBeInTheDocument();
    expect(screen.getAllByText(/需要人工治理/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "治理要求" })).toBeInTheDocument();
    expect(screen.getAllByText(/需要独立审批/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("关键证据").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "提交复核结论" })).toBeDisabled();
    expect(screen.getAllByText("你没有复核权限").length).toBeGreaterThan(0);
  });

  it("keeps Decision usable when the AI recommendation is unavailable", async () => {
    mockApi({ analysisError: true });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/decision");

    expect(await screen.findByText("智能判断暂不可用")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "治理要求" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入治理" })).toBeInTheDocument();
  });

  it("renders route_quotation_to_review as an internal review transition", async () => {
    const routeDecision = {
      ...decisionFixture,
      id: "decision-route",
      output: {
        ...decisionFixture.output,
        recommendedOptionId: "route-quotation",
        options: [{
          ...decisionFixture.output.options[0]!,
          id: "route-quotation",
          actionType: "route_quotation_to_review" as const,
          title: "送入报价复核",
          actionSummary: "将报价或商业条款差异交由授权人员复核。",
          rationale: "该异常属于报价与订单差异，需要人工复核。",
        }],
      },
    };
    const routePolicy = policyListFixture("auto_eligible");
    routePolicy.evaluations[0] = {
      ...routePolicy.evaluations[0]!,
      candidateActionType: "route_quotation_to_review",
      sourceRecommendationId: "decision-route",
      sourceOptionId: "route-quotation",
      decision: {
        ...routePolicy.evaluations[0]!.decision,
        matchedPolicyIds: ["policy-route-quotation-review-auto-eligible"],
        reasons: ["human_review_transition"],
        actionMetadata: {
          ...routePolicy.evaluations[0]!.decision.actionMetadata,
          actionType: "route_quotation_to_review",
          effectClass: "internal_review",
          humanReviewTransition: true,
          requiresApprovalBeforeExecution: false,
          materialBusinessEffect: false,
        },
      },
    };
    mockApi({ decision: routeDecision, policyList: routePolicy });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/decision");

    expect(await screen.findByRole("heading", { name: "送入报价复核" })).toBeInTheDocument();
    expect(screen.getAllByText("可进入受控内部流程").length).toBeGreaterThan(0);
    expect(screen.getByText("该动作本身是进入人工复核，不需要额外审批。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /提交人工复核/ })).toBeInTheDocument();
  });

  it("marks approve_or_change_quotation_terms as human-only", async () => {
    const commercialDecision = {
      ...decisionFixture,
      id: "decision-commercial",
      output: {
        ...decisionFixture.output,
        recommendedOptionId: "commercial-terms",
        options: [{
          ...decisionFixture.output.options[0]!,
          id: "commercial-terms",
          actionType: "approve_or_change_quotation_terms" as const,
          title: "批准或变更报价条款",
          actionSummary: "对报价或商业条款作正式决定。",
          rationale: "该决定可能改变商业条款，必须由人工处理。",
        }],
      },
    };
    const commercialPolicy = policyListFixture("human_only");
    commercialPolicy.evaluations[0] = {
      ...commercialPolicy.evaluations[0]!,
      candidateActionType: "approve_or_change_quotation_terms",
      sourceRecommendationId: "decision-commercial",
      sourceOptionId: "commercial-terms",
      decision: {
        ...commercialPolicy.evaluations[0]!.decision,
        matchedPolicyIds: ["policy-approve-quotation-terms-human-only"],
        reasons: ["commercial_terms_decision_requires_human"],
        actionMetadata: {
          ...commercialPolicy.evaluations[0]!.decision.actionMetadata,
          actionType: "approve_or_change_quotation_terms",
          effectClass: "commercial_decision",
          customerFacing: true,
          financialMovement: true,
          reversible: false,
          humanReviewTransition: false,
          requiresApprovalBeforeExecution: true,
          materialBusinessEffect: true,
        },
      },
    };
    mockApi({ decision: commercialDecision, policyList: commercialPolicy });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/decision");

    expect(await screen.findByRole("heading", { name: "批准或变更报价条款" })).toBeInTheDocument();
    expect(screen.getAllByText("仅人工决策").length).toBeGreaterThan(0);
    expect(screen.getByText("涉及报价或商业条款变更，必须由人工决策。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /执行/ })).not.toBeInTheDocument();
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
    const auditButtons = await screen.findAllByRole("button", { name: "审计详情" });
    await userEvent.setup().click(auditButtons.at(-1)!);
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
    expect(actionTypeLabel("route_quotation_to_review")).toBe("送入报价复核");
    expect(actionTypeLabel("approve_or_change_quotation_terms")).toBe("批准或变更报价条款");
    expect(actionTypeLabel("review_quotation")).toBe("复核报价（历史）");
    expect(businessFactLabel("qty")).toBe("数量");
    expect(businessFactLabel("internalRiskFlag")).toBe("业务事实");
    expect(sourceSystemLabel("manual", "Service Demo")).toBe("人工记录");
    expect(sourceSystemLabel("service", "Service")).toBe("客户服务记录");
    expect(sourceSystemLabel("wms", "WMS Demo")).toBe("仓储系统");
  });
});
