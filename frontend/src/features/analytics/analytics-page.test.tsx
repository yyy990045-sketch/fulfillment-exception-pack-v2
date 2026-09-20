import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { AnalyticsPage } from "./pages/analytics-page.js";

const embedMock = vi.hoisted(() => ({
  props: undefined as undefined | { embedConfig: { accessToken: string }; eventHandlers: Map<string, (event?: unknown) => void> },
}));

vi.mock("powerbi-client-react", () => ({
  PowerBIEmbed: (props: NonNullable<typeof embedMock.props>) => {
    embedMock.props = props;
    return <div data-testid="powerbi-embed" />;
  },
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <MemoryRouter initialEntries={["/analytics"]}>
          <AnalyticsPage />
        </MemoryRouter>
      </DemoSettingsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  embedMock.props = undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Analytics page", () => {
  it("shows a report-area loading state without a page spinner", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    renderPage();
    expect(await screen.findByTestId("analytics-loading")).toBeInTheDocument();
    expect(screen.queryByText("Power BI 尚未配置")).not.toBeInTheDocument();
  });

  it("shows administrator configuration guidance when Power BI is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "POWERBI_NOT_CONFIGURED" }, 503)));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Power BI 尚未配置" })).toBeInTheDocument();
    expect(screen.getByText("Microsoft Entra 应用与客户端凭据")).toBeInTheDocument();
    expect(screen.queryByText("查看技术信息")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
  });

  it("shows a stable backend error with a collapsed technical code", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "POWERBI_AUTH_FAILED" }, 502)));
    renderPage();
    expect(await screen.findByText("分析报告加载失败")).toBeInTheDocument();
    expect(screen.getByText("POWERBI_AUTH_FAILED")).toBeInTheDocument();
  });

  it("maps a valid backend config into the official embed component", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      configured: true,
      reportId: "report-id",
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=report-id",
      embedToken: "embed-token",
      tokenType: "Embed",
      expiresAt: "2026-09-20T12:00:00.000Z",
    })));
    renderPage();
    expect(await screen.findByTestId("powerbi-embed")).toBeInTheDocument();
    expect(embedMock.props?.embedConfig.accessToken).toBe("embed-token");
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
  });

  it("renders a provider error event instead of only logging it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      configured: true,
      reportId: "report-id",
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=report-id",
      embedToken: "embed-token",
      tokenType: "Embed",
      expiresAt: "2026-09-20T12:00:00.000Z",
    })));
    renderPage();
    await screen.findByTestId("powerbi-embed");
    act(() => embedMock.props?.eventHandlers.get("error")?.({ detail: { message: "provider unavailable" } }));
    expect(await screen.findByText("provider unavailable")).toBeInTheDocument();
    expect(screen.getByText("分析报告加载失败")).toBeInTheDocument();
  });
});
