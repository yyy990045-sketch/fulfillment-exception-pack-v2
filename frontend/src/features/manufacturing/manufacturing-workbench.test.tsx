import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../app/app-shell.js";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { evidenceBundleFixture, workbenchFixture } from "../../test/fixtures/manufacturing.js";
import { ManufacturingWorkbenchPage } from "./pages/manufacturing-workbench-page.js";
import type { EvidenceBundleView } from "./types.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function mockApi(options: { workbench?: unknown; evidence?: EvidenceBundleView | unknown; error?: boolean } = {}) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (options.error) return jsonResponse({ error: "not_found" }, 500);
    if (url.includes("/workbench")) return jsonResponse(options.workbench ?? workbenchFixture);
    if (url.includes("/bundle")) return jsonResponse(options.evidence ?? evidenceBundleFixture);
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
    expect(screen.getByText("7 条规则评估 · 4 命中 · 3 未命中")).toBeInTheDocument();
    expect(screen.getAllByTestId("exception-item")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /客户签收主张差异/ })).toHaveAttribute("aria-current", "true");
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
    await user.click(claimRow);
    const inspector = await screen.findByTestId("evidence-inspector");
    expect(inspector).toHaveTextContent("客户主张收到");
    expect(inspector).toHaveTextContent("客户主张收到=8");
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
});
