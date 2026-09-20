import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { operationalAnalyticsFixture } from "../../test/fixtures/operations.js";
import type { OperationalAnalyticsView } from "./types.js";
import { OperationsPage } from "./pages/operations-page.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function mockApi(options: {
  analytics?: OperationalAnalyticsView | { status: number };
} = {}) {
  const analytics = options.analytics ?? operationalAnalyticsFixture;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v2/analytics/operational") {
      return analytics && "status" in analytics
        ? jsonResponse({ error: "analytics_unavailable" }, analytics.status)
        : jsonResponse(analytics);
    }
    if (url.pathname === "/api/v2/contexts/ctx-mfg/resolution-cases") {
      return jsonResponse({
        contextId: "ctx-mfg",
        resolutionCases: [{
          id: "resolution-mfg",
          exceptionId: "exception-mfg",
          status: "pending_approval",
          ownerRole: "品质负责人",
          title: "客户签收治理",
          createdAt: "2026-09-19T00:00:00.000Z",
          updatedAt: "2026-09-19T00:00:00.000Z",
        }],
      });
    }
    return jsonResponse({ error: "not_found" }, 404);
  }));
}

function renderPage(initialEntry = "/operations") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/manufacturing/:contextId" element={<div>制造工作台</div>} />
            <Route path="/workspace/:contextId" element={<div>通用工作台</div>} />
          </Routes>
        </MemoryRouter>
      </DemoSettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Operations work queue", () => {
  it("opens on the pending queue with business-first rows and no KPI dashboard", async () => {
    mockApi();
    renderPage();

    expect(await screen.findByRole("heading", { name: "运营中心" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /待处理/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("异常总数")).not.toBeInTheDocument();
    expect(screen.queryByText("业务上下文组合")).not.toBeInTheDocument();
    const table = await screen.findByTestId("operations-work-queue");
    expect(within(table).getAllByTestId("operations-row")).toHaveLength(2);
    expect(within(table).getByText("客户签收主张差异等 2 类异常")).toBeInTheDocument();
    expect(within(table).getByText("SO-MFG-001 · 销售订单 · 4 个异常")).toBeInTheDocument();
    expect(within(table).getByText("等待独立审批")).toBeInTheDocument();
    expect(within(table).getByText("拟定处置方案")).toBeInTheDocument();
  });

  it("keeps view, search, filter and sort state in the URL-backed queue", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage("/operations?view=all&sort=updated_asc");

    await screen.findByTestId("operations-work-queue");
    await user.click(screen.getByRole("tab", { name: /高风险/ }));
    expect(screen.getAllByTestId("operations-row")).toHaveLength(1);
    expect(screen.getByText("客户签收主张差异等 2 类异常")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /筛选/ }));
    await user.selectOptions(screen.getByLabelText("负责人"), "财务");
    expect(await screen.findByText("没有匹配当前搜索和筛选条件的异常")).toBeInTheDocument();
    expect(screen.getByText("负责人：财务")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清除全部" }));
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("tab", { name: /全部/ }));
    await user.type(screen.getByLabelText("搜索异常"), "FIN");
    expect(screen.queryByText("客户签收主张差异等 2 类异常")).not.toBeInTheDocument();
    expect(screen.getByText("FIN-REC-001 · 财务对账 · 3 个异常")).toBeInTheDocument();
  });

  it("opens a context quick preview without leaving the queue", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("operations-work-queue");
    await user.click(screen.getAllByTestId("operations-row")[0]!);
    const preview = await screen.findByTestId("operations-quick-preview");
    expect(within(preview).getByText("SO-MFG-001 · 销售订单")).toBeInTheDocument();
    expect(within(preview).getByText("客户签收治理")).toBeInTheDocument();
    expect(within(preview).getByText(/当前运营队列不包含 Evidence 摘要/)).toBeInTheDocument();
    await user.click(within(preview).getByRole("link", { name: "打开完整记录" }));
    expect(await screen.findByText("制造工作台")).toBeInTheDocument();
  });

  it("shows a view-specific empty state", async () => {
    mockApi({
      analytics: {
        ...operationalAnalyticsFixture,
        contexts: operationalAnalyticsFixture.contexts.map((context) => ({ ...context, highestSeverity: "medium" })),
      },
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("operations-work-queue");
    await user.click(screen.getByRole("tab", { name: /高风险/ }));
    expect(await screen.findByText("没有匹配当前搜索和筛选条件的异常")).toBeInTheDocument();
  });

  it("renders four distinct analysis visuals instead of one shared bar style", async () => {
    mockApi();
    renderPage();

    await screen.findByTestId("operations-work-queue");
    const ranking = screen.getByTestId("visual-ranking-bars");
    const funnel = screen.getByTestId("visual-stage-funnel");
    const rules = screen.getByTestId("visual-rule-rate-table");
    const sources = screen.getByTestId("visual-source-share");

    // A. 排行榜：类型名称 + 排名序号 + 占本卡合计的比例
    const topRow = within(ranking).getAllByRole("listitem")[0]!;
    expect(within(topRow).getByText("客户签收主张差异")).toBeInTheDocument();
    expect(within(topRow).getByText("1")).toBeInTheDocument();
    expect(within(topRow).getByText("2")).toBeInTheDocument();
    expect(within(topRow).getByText("67%")).toBeInTheDocument();

    // B. 漏斗：0 值阶段保留（虚线占位），阶段名可见
    expect(within(funnel).getByText("待复核")).toBeInTheDocument();
    expect(within(funnel).getAllByText("0").length).toBeGreaterThanOrEqual(5);

    // C. 规则分析表：命中/评估取后端真实字段，并有全部规则合计行
    expect(within(rules).getByText("客户主张一致性")).toBeInTheDocument();
    expect(within(rules).getByText("全部规则")).toBeInTheDocument();
    expect(within(rules).getAllByText("50%").length).toBeGreaterThanOrEqual(1);

    // D. 来源占比：按涉及异常数计算占比（2/3 与 1/3）
    expect(within(sources).getByText("WMS")).toBeInTheDocument();
    expect(within(sources).getByText("67%")).toBeInTheDocument();
    expect(within(sources).getByText("33%")).toBeInTheDocument();
  });

  it("keeps a local error state inside each analysis module", async () => {
    mockApi({ analytics: { status: 500 } });
    renderPage();

    await screen.findByText("运营队列加载失败");
    expect(screen.queryByTestId("visual-ranking-bars")).not.toBeInTheDocument();
    expect(screen.queryByTestId("visual-rule-rate-table")).not.toBeInTheDocument();
    expect(screen.getAllByText("该视觉暂时无法加载，请刷新后重试").length).toBeGreaterThanOrEqual(4);
  });

  it("keeps API failure local to the queue", async () => {
    mockApi({ analytics: { status: 500 } });
    renderPage();

    expect(await screen.findByRole("heading", { name: "运营中心" })).toBeInTheDocument();
    expect(await screen.findByText("运营队列加载失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
