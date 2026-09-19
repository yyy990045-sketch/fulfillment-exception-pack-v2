import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./app-shell.js";
import { DemoSettingsProvider } from "./demo-settings.js";

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <MemoryRouter>
          <AppShell><div>工作台</div></AppShell>
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

describe("B2B account area", () => {
  it("keeps the product surfaces inside the same React shell", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      currentActor: {
        tenantId: "demo-manufacturing",
        organization: "示例制造企业",
        organizationSource: "demo",
        user: "品质负责人",
        subjectId: "demo-quality-owner",
        roles: ["品质负责人"],
        authnMethod: "demo-header",
      },
    })));
    renderShell();

    expect(await screen.findByRole("link", { name: "运营视图" })).toHaveAttribute("href", "/operations");
    expect(screen.getByRole("link", { name: "方案包" })).toHaveAttribute("href", "/workspace");
  });

  it("shows Bearer organization, user, and roles from the backend", async () => {
    window.localStorage.setItem("authToken", "bearer-token");
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer bearer-token");
      return jsonResponse({
        currentActor: {
          tenantId: "tenant-acme",
          organization: "Acme 制造",
          organizationSource: "claim",
          user: "Alice",
          subjectId: "user-alice",
          roles: ["采购经理", "审批人"],
          authnMethod: "jwt-hs256",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderShell();

    expect((await screen.findAllByText("Acme 制造")).length).toBeGreaterThan(0);
    expect(screen.getByText("Alice · 采购经理、审批人")).toBeInTheDocument();
    expect(screen.queryByText("当前企业")).not.toBeInTheDocument();
    expect(screen.queryByText("已认证用户")).not.toBeInTheDocument();
    expect(screen.queryByText("由后端权限决定")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("切换业务角色")).not.toBeInTheDocument();
  });

  it("labels tenant fallback as an unconfigured organization", async () => {
    window.localStorage.setItem("authToken", "bearer-token");
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      currentActor: {
        tenantId: "tenant-acme",
        organization: "tenant-acme",
        organizationSource: "tenant_fallback",
        user: "Alice",
        subjectId: "user-alice",
        roles: ["审批人"],
        authnMethod: "jwt-hs256",
      },
    })));
    renderShell();

    expect((await screen.findAllByText("租户：tenant-acme")).length).toBeGreaterThan(0);
    expect(screen.getByText("组织名称未配置")).toBeInTheDocument();
    expect(screen.queryByText("tenant-acme")).not.toBeInTheDocument();
  });

  it("refreshes the demo account role from the backend after actor switching", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const actorId = new Headers(init?.headers).get("x-actor") ?? "quality-owner";
      const isSales = actorId === "sales-director";
      return jsonResponse({
        currentActor: {
          tenantId: "demo-manufacturing",
          organization: "示例制造企业",
          organizationSource: "demo",
          user: isSales ? "销售总监" : "品质负责人",
          subjectId: `demo-${actorId}`,
          roles: [isSales ? "销售总监" : "品质负责人"],
          authnMethod: "demo-header",
        },
      });
    }));
    renderShell();

    expect(await screen.findByText("品质负责人 · 品质负责人")).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText("切换业务角色"), "sales-director");
    await waitFor(() => expect(screen.getByText("销售总监 · 销售总监")).toBeInTheDocument());
  });
});
