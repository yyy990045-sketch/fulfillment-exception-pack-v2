import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { GovernanceActionControllerProvider, useGovernanceActionController } from "./governance-action-controller.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function Consumer({ id, action }: { id: string; action: "approve" | "submit" }) {
  const { mutations, requestAction } = useGovernanceActionController();
  const pending = mutations[action].mutation.isPending;
  return (
    <div>
      <button type="button" onClick={() => requestAction(action, { caseId: "case-1" } as never, "操作成功")}>
        {id}
      </button>
      <span>{pending ? `${id}:pending` : `${id}:idle`}</span>
    </div>
  );
}

function renderController() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <GovernanceActionControllerProvider
          contextId="ctx-fixture"
          exceptionId="exception-fixture"
          businessKey="SO-FIXTURE-001"
          exceptionLabel="客户签收主张差异"
        >
          <Consumer id="header" action="approve" />
          <Consumer id="workspace" action="approve" />
          <Consumer id="submit" action="submit" />
        </GovernanceActionControllerProvider>
      </DemoSettingsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("governance action controller", () => {
  it("shares one in-flight action between header and workspace consumers", async () => {
    const user = userEvent.setup();
    let resolveApprove: ((response: Response) => void) | undefined;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname;
      calls.push(path);
      if (path === "/api/v2/auth/context") {
        return jsonResponse({
          currentActor: {
            tenantId: "demo-manufacturing",
            organization: "示例制造企业",
            organizationSource: "demo",
            user: "总经理",
            subjectId: "demo-general-manager",
            roles: ["总经理"],
            authnMethod: "demo-header",
          },
        });
      }
      if (path.endsWith("/approve")) {
        return new Promise<Response>((resolve) => { resolveApprove = resolve; });
      }
      return jsonResponse({});
    }));

    renderController();
    await user.click(screen.getByRole("button", { name: "header" }));
    const sheet = await screen.findByTestId("governance-confirmation-sheet");
    await user.click(within(sheet).getByRole("button", { name: "确认批准" }));

    expect(await screen.findByText("header:pending")).toBeInTheDocument();
    expect(screen.getByText("workspace:pending")).toBeInTheDocument();
    expect(calls.filter((path) => path.endsWith("/approve"))).toHaveLength(1);
    resolveApprove?.(new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }));
    expect(await screen.findByText("操作成功")).toBeInTheDocument();
  });

  it("provides non-blocking feedback for non-confirmed actions", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/v2/auth/context") {
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
      return jsonResponse({});
    }));

    renderController();
    await user.click(screen.getByRole("button", { name: "submit" }));
    expect(screen.queryByTestId("governance-confirmation-sheet")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("操作成功")).toBeInTheDocument());
  });
});
