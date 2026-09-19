import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { resolutionCapabilitiesFixture } from "../../test/fixtures/governance.js";
import { ManufacturingWorkbenchPage } from "./pages/manufacturing-workbench-page.js";
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
    const url = String(input);
    const pathname = new URL(url, window.location.origin).pathname;
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
    if (pathname.endsWith("/resolution-cases")) return jsonResponse({ contextId: "ctx-fixture", resolutionCases: [] });
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/manufacturing/ctx-so-mfg-001" replace />} />
              <Route path="/manufacturing/:contextId" element={<ManufacturingWorkbenchPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId" element={<ManufacturingWorkbenchPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/evidence" element={<ManufacturingWorkbenchPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/analysis" element={<ManufacturingWorkbenchPage />} />
              <Route path="/manufacturing/:contextId/exceptions/:exceptionId/decision" element={<ManufacturingWorkbenchPage />} />
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

describe("Manufacturing decision workbench", () => {
  it("renders local loading state before the workbench API resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderAt("/manufacturing/ctx-fixture");
    expect(screen.getByTestId("workbench-loading")).toBeInTheDocument();
  });

  it("renders a local error instead of a blank page", async () => {
    mockApi({ error: true });
    renderAt("/manufacturing/ctx-fixture");
    expect(await screen.findByText("履约上下文加载失败")).toBeInTheDocument();
  });

  it("renders API-projected context, 8 stages, 7 rules, 4 exceptions, and the default exception", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture");
    expect(await screen.findByRole("heading", { name: "SO-FIXTURE-001" })).toBeInTheDocument();
    expect(screen.getAllByTestId("thread-stage")).toHaveLength(8);
    expect(screen.getByText("7 条唯一规则评估 · 4 命中 · 3 未命中")).toBeInTheDocument();
    const ruleIds = screen.getAllByTestId("rule-chip").map((item) => item.getAttribute("data-rule-id"));
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
    expect(screen.getAllByTestId("exception-item")).toHaveLength(4);
    const exceptionOrder = screen.getAllByTestId("exception-item").map((item) => item.textContent ?? "");
    expect(exceptionOrder.findIndex((item) => item.includes("客户签收主张差异"))).toBeLessThan(
      exceptionOrder.findIndex((item) => item.includes("回款未结清")),
    );
    expect(exceptionOrder.findIndex((item) => item.includes("发货数量短少"))).toBeLessThan(
      exceptionOrder.findIndex((item) => item.includes("质检未通过数量")),
    );
    expect(screen.getByRole("button", { name: /客户签收主张差异/ })).toHaveAttribute("aria-current", "true");
    expect(await screen.findByText("是否存在客户签收单或其他独立签收证据？")).toBeInTheDocument();
  });

  it("uses Chinese business labels for governance actions, facts, and source systems", () => {
    expect(governanceActionStatusLabel("draft")).toBe("方案草稿");
    expect(governanceActionStatusLabel("pending_approval")).toBe("待审批");
    expect(governanceActionStatusLabel("authorized")).toBe("已授权");
    expect(governanceActionStatusLabel("executing")).toBe("执行中");
    expect(governanceActionStatusLabel("succeeded")).toBe("已完成");
    expect(governanceActionStatusLabel("failed")).toBe("执行失败");
    expect(governanceActionStatusLabel("verified")).toBe("已核验");
    expect(governanceActionStatusLabel("unknown")).toBe("状态未记录");
    expect(businessFactLabel("qty")).toBe("数量");
    expect(businessFactLabel("completedQty")).toBe("完成数量");
    expect(businessFactLabel("internalRiskFlag")).toBe("业务事实");
    expect(sourceSystemLabel("manual", "Service Demo")).toBe("人工记录");
    expect(sourceSystemLabel("service", "Service")).toBe("客户服务记录");
    expect(sourceSystemLabel("wms", "WMS Demo")).toBe("仓储系统");
  });

  it("filters and sorts the exception queue without leaving internal fields in the list", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });

    const search = screen.getByLabelText("搜索异常");
    await user.type(search, "回款");
    expect(screen.getAllByTestId("exception-item")).toHaveLength(1);
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /回款未结清/ })).toBeInTheDocument();
    expect(screen.queryByText(/rule-7/)).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "不存在的异常");
    expect(await screen.findByText("没有匹配当前条件的异常")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getAllByTestId("exception-item")).toHaveLength(4);

    await user.selectOptions(screen.getByLabelText("严重程度"), "high");
    expect(screen.getAllByTestId("exception-item")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "清除筛选" }));

    await user.selectOptions(screen.getByLabelText("业务阶段"), "shipment");
    expect(screen.getAllByTestId("exception-item")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "清除筛选" }));

    await user.selectOptions(screen.getByLabelText("处理阶段"), "approval");
    expect(screen.getAllByTestId("exception-item")).toHaveLength(1);
    expect(screen.getByText("质检未通过数量")).toBeInTheDocument();
  });

  it("preserves queue filters when switching exception workspaces", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });

    await user.type(screen.getByLabelText("搜索异常"), "回款");
    await user.click(screen.getByRole("tab", { name: "证据" }));
    await waitFor(() => expect(window.location.pathname).toContain("/evidence"));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("回款");
    expect(screen.getByLabelText("搜索异常")).toHaveValue("回款");
  });

  it("runs the current selected exception quick action from the header", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });
    await user.click(screen.getByRole("button", { name: "进入治理" }));
    expect(await screen.findByRole("heading", { name: "决策建议" })).toBeInTheDocument();
    expect(screen.getByTestId("selected-exception-header")).toBeInTheDocument();
  });

  it("shows a concise fallback when no verification questions exist", async () => {
    mockApi({
      explanationList: { contextId: "ctx-fixture", exceptionId: "exception-claim", explanations: [] },
    });
    renderAt("/manufacturing/ctx-fixture");
    expect(await screen.findByText("暂无明确待核实事项")).toBeInTheDocument();
  });

  it("distinguishes loading and error states while reading verification questions", async () => {
    mockApi({ holdExplanationList: true });
    renderAt("/manufacturing/ctx-fixture");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });
    expect(screen.getByText("正在读取待核实事项")).toBeInTheDocument();
    cleanup();

    mockApi({ explanationListError: true });
    renderAt("/manufacturing/ctx-fixture");
    expect(await screen.findByText("待核实事项暂不可用")).toBeInTheDocument();
  });

  it("keeps raw identifiers and fact keys inside the page-level details sheet", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });
    expect(screen.queryByText("ctx-fixture")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "详情" }));
    expect(await screen.findByText("ctx-fixture")).toBeInTheDocument();
    expect(screen.getByText("qty")).toBeInTheDocument();
    expect(screen.getByText("evidence-shipment")).toBeInTheDocument();
  });

  it("navigates between exceptions with deep links", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture");
    await screen.findByRole("heading", { name: "SO-FIXTURE-001" });
    await user.click(screen.getByRole("button", { name: /回款未结清/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/manufacturing/ctx-fixture/exceptions/exception-payment"));
    expect(await screen.findByRole("heading", { name: "回款未结清" })).toBeInTheDocument();
  });

  it("renders Evidence rows and preserves claim wording in the inspector", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/evidence");
    const claimRow = await screen.findByRole("button", { name: /客户主张.*客户主张收到/ });
    expect(screen.queryByText(/2026-09-19T/)).not.toBeInTheDocument();
    await user.click(claimRow);
    const inspector = await screen.findByTestId("evidence-inspector");
    expect(inspector).toHaveTextContent("客户主张收到");
    expect(inspector).toHaveTextContent("客户主张收到=8");
    expect(screen.getAllByText("仓储系统").length).toBeGreaterThan(0);
    expect(screen.getAllByText("人工记录").length).toBeGreaterThan(0);
  });

  it("filters the evidence workspace and reports no matching results", async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/evidence");
    expect(await screen.findAllByTestId("evidence-row")).toHaveLength(2);

    await user.type(screen.getByLabelText("搜索证据"), "发货数量");
    await waitFor(() => expect(screen.getAllByTestId("evidence-row")).toHaveLength(1));
    expect(screen.getByText("1 / 2 条")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("搜索证据"));
    await user.type(screen.getByLabelText("搜索证据"), "不匹配");
    expect(await screen.findByText("没有匹配当前条件的证据")).toBeInTheDocument();
  });

  it("supports evidence deep links and browser back behavior", async () => {
    mockApi();
    window.history.replaceState({}, "", "/manufacturing/ctx-fixture/exceptions/exception-claim");
    window.history.pushState({}, "", "/manufacturing/ctx-fixture/exceptions/exception-claim/evidence?evidence=evidence-claim");
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/evidence?evidence=evidence-claim", { resetHistory: false });
    expect(await screen.findByTestId("evidence-inspector")).toHaveTextContent("Evidence ID");
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByTestId("evidence-inspector")).not.toBeInTheDocument());
  });

  it("renders a concise empty state when the evidence bundle is empty", async () => {
    mockApi({ evidence: { ...evidenceBundleFixture, evidenceIds: [], evidence: [] } });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/evidence");
    expect(await screen.findByText("暂无相关证据")).toBeInTheDocument();
  });

  it("renders grounded facts, unknowns, and verification questions", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    expect(await screen.findByRole("heading", { name: "AI 解释" })).toBeInTheDocument();
    expect(await screen.findByText("已知事实")).toBeInTheDocument();
    expect(screen.getByText("系统记录的发货数量为 10。")).toBeInTheDocument();
    expect(screen.getByText("未知信息")).toBeInTheDocument();
    expect(screen.getByText("当前不能确认客户实际签收数量。")).toBeInTheDocument();
    expect(screen.getByText("待核实事项")).toBeInTheDocument();
    expect(screen.getByText("是否存在客户签收单或其他独立签收证据？")).toBeInTheDocument();
  });

  it("marks root cause results as hypotheses and exposes supporting and contradicting evidence", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    expect(await screen.findByRole("heading", { name: "根因假设" })).toBeInTheDocument();
    expect(await screen.findByText("均为待验证假设")).toBeInTheDocument();
    expect(screen.getByText("签收记录缺失可能导致主张数量未被确认。")).toBeInTheDocument();
    expect(screen.getByText("支持证据")).toBeInTheDocument();
    expect(screen.getByText("反驳证据")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "客户主张 8" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "系统记录 10" }).length).toBeGreaterThan(0);
  });

  it("renders decision options and humanDecisionRequired without presenting execution", async () => {
    mockApi();
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/decision");
    expect(await screen.findByRole("heading", { name: "决策建议" })).toBeInTheDocument();
    expect(await screen.findByText("需要人工决策")).toBeInTheDocument();
    expect(screen.getByText("建议不是执行结果")).toBeInTheDocument();
    expect(screen.getByText("补充签收证据")).toBeInTheDocument();
    expect(screen.getByText("人工复核")).toBeInTheDocument();
    expect(screen.getByText("数量 10")).toBeInTheDocument();
    expect(screen.queryByText(/qty/)).not.toBeInTheDocument();
    expect(screen.queryByText("自动化执行")).not.toBeInTheDocument();
  });

  it("hides unknown Decision fact keys behind a business fallback", async () => {
    const decision = structuredClone(decisionFixture);
    decision.output.options[0]!.supportingFacts.push({
      kind: "metric",
      key: "internalRiskFlag",
      value: 99,
      evidenceIds: [],
    });
    mockApi({ decision });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/decision");
    expect(await screen.findByText("业务事实 99")).toBeInTheDocument();
    expect(screen.queryByText(/internalRiskFlag/)).not.toBeInTheDocument();
  });

  it("surfaces stale analysis snapshots", async () => {
    mockApi({
      explanationList: { ...explanationListFixture, explanations: explanationListFixture.explanations.map((item) => ({ ...item, stale: true })) },
      explanation: { ...explanationFixture, stale: true, explanation: { ...explanationFixture.explanation, stale: true } },
      rootCauseList: { ...rootCauseListFixture, analyses: rootCauseListFixture.analyses.map((item) => ({ ...item, stale: true })) },
      rootCause: { ...rootCauseFixture, stale: true },
    });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    expect(await screen.findByRole("heading", { name: "AI 解释" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("基于旧证据快照").length).toBeGreaterThanOrEqual(2));
  });

  it("shows explicit empty states when no analysis result exists", async () => {
    mockApi({
      explanationList: { contextId: "ctx-fixture", exceptionId: "exception-claim", explanations: [] },
      rootCauseList: { contextId: "ctx-fixture", exceptionId: "exception-claim", analyses: [] },
      decisionList: { contextId: "ctx-fixture", exceptionId: "exception-claim", recommendations: [] },
    });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    await waitFor(() => expect(screen.getAllByText("暂无生成结果")).toHaveLength(2));
  });

  it("supports analysis deep links and browser back behavior", async () => {
    mockApi();
    window.history.replaceState({}, "", "/manufacturing/ctx-fixture/exceptions/exception-claim");
    window.history.pushState({}, "", "/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis", { resetHistory: false });
    expect(await screen.findByRole("heading", { name: "AI 解释" })).toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "AI 解释" })).not.toBeInTheDocument());
  });

  it("keeps analysis errors local to each section", async () => {
    mockApi({ analysisError: true });
    renderAt("/manufacturing/ctx-fixture/exceptions/exception-claim/analysis");
    expect(await screen.findByText("AI 解释加载失败")).toBeInTheDocument();
    expect(screen.getByText("根因假设加载失败")).toBeInTheDocument();
  });
});
