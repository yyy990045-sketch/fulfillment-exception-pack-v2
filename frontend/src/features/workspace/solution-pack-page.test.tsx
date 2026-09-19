import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { installedPacksFixture, operationalAnalyticsFixture, packWorkbenchFixture } from "../../test/fixtures/operations.js";
import { GenericContextWorkspacePage } from "./pages/generic-context-workspace-page.js";
import { SolutionPackPage } from "./pages/solution-pack-page.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function mockApi() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/v2/solution-packs/installed") return jsonResponse(installedPacksFixture);
    if (path === "/api/v2/analytics/operational") return jsonResponse(operationalAnalyticsFixture);
    if (path === "/api/v2/contexts/ctx-mfg/pack-workbench") {
      return jsonResponse(packWorkbenchFixture({ id: "ctx-mfg", businessKey: "SO-MFG-001", contextType: "sales_order", packId: "manufacturing-fulfillment" }));
    }
    if (path === "/api/v2/contexts/ctx-fin/pack-workbench") {
      return jsonResponse(packWorkbenchFixture({ id: "ctx-fin", businessKey: "FIN-REC-001", contextType: "finance_reconciliation", packId: "finance-reconciliation" }));
    }
    if (path === "/api/v2/contexts/ctx-fin/resolution-cases") {
      return jsonResponse({ contextId: "ctx-fin", resolutionCases: [{ id: "resolution-fin", exceptionId: "exception-fin", status: "confirmed", ownerRole: "财务", title: "回款余额治理", createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z" }] });
    }
    return jsonResponse({ error: "not_found" }, 404);
  }));
}

function renderSurface(initialEntry = "/workspace") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/workspace" element={<SolutionPackPage />} />
            <Route path="/workspace/:contextId" element={<GenericContextWorkspacePage />} />
            <Route path="/manufacturing/:contextId" element={<div>制造专属工作台</div>} />
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

describe("React Solution Pack workspace", () => {
  it("lists installed packs and switches to a finance pack context", async () => {
    mockApi();
    const user = userEvent.setup();
    renderSurface();

    expect(await screen.findByRole("heading", { name: "方案包" })).toBeInTheDocument();
    expect(screen.getAllByText("Manufacturing Fulfillment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finance Reconciliation").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Finance Reconciliation/ }));
    expect((await screen.findAllByText("FIN-REC-001")).length).toBeGreaterThan(0);
    expect(screen.getByText("银行回款")).toBeInTheDocument();
    expect(screen.getByText("回款未结清")).toBeInTheDocument();
  });

  it("renders a generic context workspace without manufacturing-specific labels", async () => {
    mockApi();
    renderSurface("/workspace/ctx-fin");

    expect(await screen.findByText("FIN-REC-001")).toBeInTheDocument();
    expect(screen.getByText("Finance Reconciliation")).toBeInTheDocument();
    expect(screen.getByText("财务对账工作台")).toBeInTheDocument();
    expect(screen.getByText("业务线程")).toBeInTheDocument();
    expect(screen.getByText("证据")).toBeInTheDocument();
    expect(screen.getByText("状态：进行中")).toBeInTheDocument();
    expect(screen.getByText("发票")).toBeInTheDocument();
    expect(screen.getByText("银行回款")).toBeInTheDocument();
    expect(screen.queryByText("Business Thread")).not.toBeInTheDocument();
    expect(screen.queryByText("evidence-fin-1")).not.toBeInTheDocument();
    expect(screen.queryByText("制造履约")).not.toBeInTheDocument();
  });
});
