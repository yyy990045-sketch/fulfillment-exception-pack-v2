import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { AnalyticsPage } from "./pages/analytics-page.js";

const embedMock = vi.hoisted(() => ({
  props: undefined as undefined | { embedConfig: { accessToken: string }; eventHandlers: Map<string, (event?: unknown) => void> },
}));

const supersetMock = vi.hoisted(() => ({
  calls: [] as Array<{ id: string; supersetDomain: string; fetchGuestToken: () => Promise<string> }>,
}));

vi.mock("powerbi-client-react", () => ({
  PowerBIEmbed: (props: NonNullable<typeof embedMock.props>) => {
    embedMock.props = props;
    return <div data-testid="powerbi-embed" />;
  },
}));

vi.mock("@superset-ui/embedded-sdk", () => ({
  embedDashboard: (options: { id: string; supersetDomain: string; fetchGuestToken: () => Promise<string> }) => {
    supersetMock.calls.push(options);
    return Promise.resolve();
  },
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function isErrorStatus(value: unknown): value is { status: number } {
  return typeof value === "object" && value !== null && "status" in value;
}

function mockFetch(options: {
  providers?: unknown;
  embedConfig?: unknown | { status: number };
  guestToken?: unknown | { status: number };
}) {
  const providers = options.providers ?? {
    providers: { superset: { configured: false }, powerbi: { configured: true } },
    defaultProvider: "powerbi",
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v2/analytics/providers") return jsonResponse(providers);
    if (url.pathname === "/api/v2/analytics/superset/guest-token") {
      const value = options.guestToken ?? { dashboardId: "uuid", supersetDomain: "http://superset.test", guestToken: "guest.jwt.token", expiresInSeconds: 300 };
      return isErrorStatus(value)
        ? jsonResponse({ error: "SUPERSET_NOT_CONFIGURED" }, value.status)
        : jsonResponse(value);
    }
    if (url.pathname === "/api/v2/analytics/powerbi/embed-config") {
      const value = options.embedConfig ?? {
        configured: true,
        reportId: "report-id",
        embedUrl: "https://app.powerbi.com/reportEmbed?reportId=report-id",
        embedToken: "embed-token",
        tokenType: "Embed",
        expiresAt: "2026-09-20T12:00:00.000Z",
      };
      return isErrorStatus(value)
        ? jsonResponse({ error: "POWERBI_AUTH_FAILED" }, value.status)
        : jsonResponse(value);
    }
    return jsonResponse({ error: "not_found" }, 404);
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
  supersetMock.calls = [];
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
    expect(screen.queryByText("分析服务尚未配置")).not.toBeInTheDocument();
  });

  it("shows administrator guidance when no analytics provider is configured", async () => {
    mockFetch({
      providers: {
        providers: { superset: { configured: false }, powerbi: { configured: false } },
        defaultProvider: null,
      },
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "分析服务尚未配置" })).toBeInTheDocument();
    expect(screen.getByText("自托管 Superset 与嵌入式看板（当前推荐）")).toBeInTheDocument();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
  });

  it("embeds the Superset dashboard through the official SDK when it is the default provider", async () => {
    mockFetch({
      providers: {
        providers: {
          superset: { configured: true, dashboardId: "dash-uuid", supersetDomain: "http://superset.test" },
          powerbi: { configured: false },
        },
        defaultProvider: "superset",
      },
    });
    renderPage();

    expect(await screen.findByTestId("superset-dashboard")).toBeInTheDocument();
    expect(supersetMock.calls).toHaveLength(1);
    expect(supersetMock.calls[0]!.id).toBe("dash-uuid");
    expect(supersetMock.calls[0]!.supersetDomain).toBe("http://superset.test");
    // SDK 通过回调向后端取 token，浏览器侧拿不到任何服务账号凭据
    await expect(supersetMock.calls[0]!.fetchGuestToken()).resolves.toBe("guest.jwt.token");
    expect(screen.queryByTestId("powerbi-embed")).not.toBeInTheDocument();
  });

  it("keeps the Power BI provider available when it is the default", async () => {
    mockFetch({});
    renderPage();
    expect(await screen.findByTestId("powerbi-embed")).toBeInTheDocument();
    expect(embedMock.props?.embedConfig.accessToken).toBe("embed-token");
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
  });

  it("shows a stable Power BI error with a collapsed technical code", async () => {
    mockFetch({ embedConfig: { status: 502 } });
    renderPage();
    expect(await screen.findByText("分析报告加载失败")).toBeInTheDocument();
    expect(screen.getByText("POWERBI_AUTH_FAILED")).toBeInTheDocument();
  });

  it("renders a Power BI provider error event instead of only logging it", async () => {
    mockFetch({});
    renderPage();
    await screen.findByTestId("powerbi-embed");
    act(() => embedMock.props?.eventHandlers.get("error")?.({ detail: { message: "provider unavailable" } }));
    expect(await screen.findByText("provider unavailable")).toBeInTheDocument();
    expect(screen.getByText("分析报告加载失败")).toBeInTheDocument();
  });
});
