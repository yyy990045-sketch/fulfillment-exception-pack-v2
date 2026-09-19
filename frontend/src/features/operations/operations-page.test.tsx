import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { installedPacksFixture, operationalAnalyticsFixture } from "../../test/fixtures/operations.js";
import { OperationsPage } from "./pages/operations-page.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function mockApi() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/v2/analytics/operational") return jsonResponse(operationalAnalyticsFixture);
    if (path === "/api/v2/solution-packs/installed") return jsonResponse(installedPacksFixture);
    if (path === "/api/v2/internal-work-items") return jsonResponse({ workItems: [] });
    return jsonResponse({ error: "not_found" }, 404);
  }));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <MemoryRouter initialEntries={["/operations"]}>
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

describe("React Operations workspace", () => {
  it("shows a compact summary and drills into a manufacturing context", async () => {
    mockApi();
    renderPage();

    expect(await screen.findByRole("heading", { name: "运营视图" })).toBeInTheDocument();
    expect(screen.getByText("异常总数")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    const portfolio = screen.getByTestId("operations-portfolio-table");
    expect(within(portfolio).getByText("SO-MFG-001")).toBeInTheDocument();
    expect(within(portfolio).getByText("FIN-REC-001")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "SO-MFG-001" }));
    expect(await screen.findByText("制造工作台")).toBeInTheDocument();
  });

  it("filters the portfolio and keeps the secondary details progressive", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "运营视图" });

    await user.type(screen.getByLabelText("搜索业务上下文"), "FIN");
    const portfolio = screen.getByTestId("operations-portfolio-table");
    await waitFor(() => expect(within(portfolio).queryByText("SO-MFG-001")).not.toBeInTheDocument());
    expect(within(portfolio).getByText("FIN-REC-001")).toBeInTheDocument();
    expect(screen.getByText("当前筛选")).toBeInTheDocument();
    expect(screen.getByText("搜索：FIN")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除全部" }));
    expect(screen.getByLabelText("搜索业务上下文")).toHaveValue("");
    expect(screen.queryByText("当前筛选")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "动作" }));
    expect(await screen.findByText("补证请求")).toBeInTheDocument();
    expect(screen.getByText("动作总数")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "异常" }));
    const exceptionTable = screen.getByTestId("operations-exceptions-table");
    expect(within(exceptionTable).getByText(/客户签收主张差异/)).toBeInTheDocument();
    expect(within(exceptionTable).queryByText("CUSTOMER_RECEIPT_CLAIM_MISMATCH")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "来源" }));
    expect((await screen.findAllByText("仓储系统")).length).toBeGreaterThan(0);
    expect(screen.queryByText("WMS")).not.toBeInTheDocument();
  });
});
