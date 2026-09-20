import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoSettingsProvider, useDemoSettings } from "../../app/demo-settings.js";
import { decisionFixture } from "../../test/fixtures/manufacturing.js";
import {
  outcomeListFixture,
  policyListFixture,
  resolutionCapabilitiesFixture,
  resolutionQueryFixture,
  resolutionReceiptFixture,
} from "../../test/fixtures/governance.js";
import type { ResolutionCapabilitiesResponseView, ResolutionCaseQueryView } from "./analysis-types.js";
import { GovernanceActionControllerProvider } from "./governance-action-controller.js";
import { GovernanceProcess } from "./components/governance-process.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function mockGovernanceApi(options: {
  initial: ResolutionCaseQueryView;
  mode?: "human_only" | "approval_required" | "auto_eligible";
  sodError?: boolean;
  holdExecution?: boolean;
  resolutionError?: boolean;
  outcomes?: typeof outcomeListFixture;
  resolutionListEmpty?: boolean;
  capabilities?: ResolutionCapabilitiesResponseView;
  capabilitiesByActor?: Record<string, ResolutionCapabilitiesResponseView>;
} ) {
  let resolution = structuredClone(options.initial);
  const calls: string[] = [];
  const currentCapabilities = () => options.capabilities ?? resolutionCapabilitiesFixture({
    status: options.resolutionListEmpty
      ? undefined
      : resolution.resolutionCase.status as "triaged" | "confirmed" | "proposed" | "approved" | "executed" | "closed" | "rejected",
    submitted: resolution.resolutionCase.runtime.actions.length > 0 &&
      resolution.resolutionCase.runtime.actions.every((action) => action.status === "pending_approval"),
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const pathname = new URL(url, window.location.origin).pathname;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${pathname}`);
    const headers = new Headers(init?.headers);
    if (method === "GET" && pathname === "/api/v2/auth/context") {
      const actorId = headers.get("x-actor") ?? "quality-owner";
      const actor = {
        "quality-owner": { user: "品质负责人", roles: ["品质负责人"] },
        "sales-director": { user: "销售总监", roles: ["销售总监"] },
        "general-manager": { user: "总经理", roles: ["总经理"] },
        admin: { user: "管理员", roles: ["管理员"] },
      }[actorId] ?? { user: actorId, roles: [] };
      return jsonResponse({
        currentActor: {
          tenantId: "demo-manufacturing",
          organization: "示例制造企业",
          organizationSource: "demo",
          user: actor.user,
          subjectId: `demo-${actorId}`,
          roles: actor.roles,
          authnMethod: "demo-header",
        },
      });
    }
    if (method === "GET" && pathname.endsWith("/resolution-capabilities")) {
      const actorId = headers.get("x-actor") ?? "quality-owner";
      return jsonResponse(options.capabilitiesByActor?.[actorId] ?? currentCapabilities());
    }
    if (method === "GET" && pathname.endsWith("/policy-evaluations")) return jsonResponse(policyListFixture(options.mode));
    if (method === "GET" && pathname.endsWith("/outcome-evaluations")) return jsonResponse(options.outcomes ?? outcomeListFixture);
    if (method === "GET" && pathname.endsWith("/resolution-cases")) {
      if (options.resolutionError) return jsonResponse({ error: "resolution_unavailable" }, 500);
      return jsonResponse({
        contextId: "ctx-fixture",
        resolutionCases: options.resolutionListEmpty ? [] : [resolution.resolutionCase],
      });
    }
    if (method === "GET" && pathname.endsWith("/resolution-cases/resolution-fixture")) return jsonResponse(resolution);
    if (method === "POST" && pathname.endsWith("/review")) {
      resolution = resolutionQueryFixture("confirmed");
      return jsonResponse(resolution.resolutionCase);
    }
    if (method === "POST" && pathname.endsWith("/propose")) {
      resolution = resolutionQueryFixture("proposed", { submitted: false });
      return jsonResponse(resolution.resolutionCase);
    }
    if (method === "POST" && pathname.endsWith("/submit")) {
      resolution = resolutionQueryFixture("proposed", { submitted: true });
      return jsonResponse(resolution.resolutionCase);
    }
    if (method === "POST" && pathname.endsWith("/approve")) {
      if (options.sodError) return jsonResponse({ error: "SEGREGATION_OF_DUTIES_VIOLATION" }, 403);
      resolution = resolutionQueryFixture("approved");
      return jsonResponse(resolution.resolutionCase);
    }
    if (method === "POST" && pathname.endsWith("/execute")) {
      if (options.holdExecution) return new Promise(() => {});
      resolution = resolutionQueryFixture("executed", { receipts: [resolutionReceiptFixture()] });
      return jsonResponse(resolution.resolutionCase);
    }
    if (method === "POST" && pathname.endsWith("/close")) {
      resolution = resolutionQueryFixture("closed", { receipts: [resolutionReceiptFixture()] });
      return jsonResponse(resolution.resolutionCase);
    }
    if (method === "POST" && pathname.endsWith("/resolution-case")) {
      resolution = resolutionQueryFixture("triaged");
      return jsonResponse(resolution.resolutionCase);
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderProcess(selectedOptionId = "option-evidence") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const tree = (optionId: string) => (
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <ActorSwitch />
        <GovernanceActionControllerProvider
          contextId="ctx-fixture"
          exceptionId="exception-claim"
          businessKey="SO-FIXTURE-001"
          exceptionLabel="客户签收主张差异"
        >
          <GovernanceProcess
            contextId="ctx-fixture"
            exceptionId="exception-claim"
            recommendation={decisionFixture}
            selectedOptionId={optionId}
          />
        </GovernanceActionControllerProvider>
      </DemoSettingsProvider>
    </QueryClientProvider>
  );
  const view = render(tree(selectedOptionId));
  return {
    ...view,
    rerenderSelection(optionId: string) {
      view.rerender(tree(optionId));
    },
  };
}

function ActorSwitch() {
  const { setActorId } = useDemoSettings();
  return <button type="button" onClick={() => setActorId("sales-director")}>切换销售总监</button>;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("governance process", () => {
  it("resets the proposal draft when the Decision candidate changes", async () => {
    mockGovernanceApi({ initial: resolutionQueryFixture("confirmed") });
    const view = renderProcess("option-evidence");
    const action = await screen.findByLabelText("治理动作");
    const summary = await screen.findByLabelText("动作说明与完成标准");
    expect(action).toHaveValue("supplement_evidence");
    expect(summary).toHaveValue("收集客户签收单和物流记录。");

    view.rerenderSelection("option-review");
    await waitFor(() => expect(action).toHaveValue("route_quotation_to_review"));
    expect(summary).toHaveValue("由业务人员复核当前差异。");
  });

  it("keeps review, propose, and submit as real mutations", async () => {
    const user = userEvent.setup();
    mockGovernanceApi({ initial: resolutionQueryFixture("triaged") });
    renderProcess();

    const reviewRationale = await screen.findByLabelText("复核说明");
    await user.type(reviewRationale, "确认进入处置。");
    await user.click(screen.getByRole("button", { name: "提交复核" }));

    const proposalSummary = await screen.findByLabelText("动作说明与完成标准");
    await user.clear(proposalSummary);
    await user.type(proposalSummary, "补充客户签收证据。");
    await user.click(screen.getByRole("button", { name: "拟定处置方案" }));

    await user.click(await screen.findByRole("button", { name: "提交审批" }));
    expect(await screen.findByText("等待审批")).toBeInTheDocument();
    expect(await screen.findByText("已提交审批")).toBeInTheDocument();
  });

  it("keeps draft proposals as 未提交审批 and submitted proposals as 等待审批", async () => {
    mockGovernanceApi({ initial: resolutionQueryFixture("proposed", { submitted: false }) });
    renderProcess();
    expect(await screen.findByText("未提交审批")).toBeInTheDocument();
    expect(screen.getByText("方案草稿")).toBeInTheDocument();
    expect(screen.queryByText("draft")).not.toBeInTheDocument();
    expect(screen.getByTestId("process-step-governance")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("process-step-approval")).toHaveAttribute("data-status", "pending");
    expect(screen.getByRole("button", { name: "提交审批" })).toBeInTheDocument();
    cleanup();

    mockGovernanceApi({ initial: resolutionQueryFixture("proposed", { submitted: true }) });
    renderProcess();
    expect(await screen.findByText("等待审批")).toBeInTheDocument();
    expect(screen.queryByText("pending_approval")).not.toBeInTheDocument();
    expect(screen.getByTestId("process-step-governance")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("process-step-approval")).toHaveAttribute("data-status", "current");
  });

  it("shows approval requirements and the backend SoD rejection", async () => {
    const user = userEvent.setup();
    mockGovernanceApi({
      initial: resolutionQueryFixture("proposed", { submitted: true }),
      mode: "approval_required",
      sodError: true,
    });
    renderProcess();

    expect(await screen.findByText(/需人工审批/)).toBeInTheDocument();
    expect(screen.getByText(/处理资格：需人工审批/)).toBeInTheDocument();
    expect(screen.getByText("总经理")).toBeInTheDocument();
    expect(screen.getByText(/复核人：品质负责人；方案提出人：工程师/)).toBeInTheDocument();
    expect(screen.getByText(/复核人与方案提出人不能由同一人担任/)).toBeInTheDocument();
    expect(screen.getByTestId("process-step-outcome")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("process-step-outcome")).toHaveTextContent("已有后续测量");
    await user.click(screen.getByRole("button", { name: "批准方案" }));
    const confirmation = await screen.findByTestId("governance-confirmation-sheet");
    expect(within(confirmation).getByText("SO-FIXTURE-001")).toBeInTheDocument();
    expect(within(confirmation).getByText("客户签收主张差异")).toBeInTheDocument();
    expect(within(confirmation).getByText("批准当前治理方案")).toBeInTheDocument();
    expect(within(confirmation).getByText(/品质负责人 · 品质负责人/)).toBeInTheDocument();
    expect(within(confirmation).getByText(/批准后方案将进入可执行状态/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认批准" }));
    expect(await within(confirmation).findByRole("alert")).toHaveTextContent(/复核\/方案提出人与审批人必须分离/);
  });

  it("disables approval before click when the backend denies the current role", async () => {
    mockGovernanceApi({
      initial: resolutionQueryFixture("proposed", { submitted: true }),
      capabilities: resolutionCapabilitiesFixture({
        status: "proposed",
        submitted: true,
        overrides: {
          canApprove: {
            applicable: true,
            allowed: false,
            reasonCode: "ROLE_NOT_ALLOWED",
            reason: "当前角色没有审批权限",
          },
        },
      }),
    });
    renderProcess();

    expect(await screen.findByRole("button", { name: "批准方案" })).toBeDisabled();
    expect(screen.getByText("当前角色没有审批权限")).toBeInTheDocument();
  });

  it("shows the segregation-of-duties reason before approval is clicked", async () => {
    mockGovernanceApi({
      initial: resolutionQueryFixture("proposed", { submitted: true }),
      capabilities: resolutionCapabilitiesFixture({
        status: "proposed",
        submitted: true,
        overrides: {
          canApprove: {
            applicable: true,
            allowed: false,
            reasonCode: "SEGREGATION_OF_DUTIES_VIOLATION",
            reason: "方案提出人与审批人必须分离",
          },
        },
      }),
    });
    renderProcess();

    expect(await screen.findByRole("button", { name: "批准方案" })).toBeDisabled();
    expect(screen.getByText("方案提出人与审批人必须分离")).toBeInTheDocument();
  });

  it("executes a real approve mutation when the backend capability allows it", async () => {
    const user = userEvent.setup();
    const calls = mockGovernanceApi({
      initial: resolutionQueryFixture("proposed", { submitted: true }),
      capabilities: resolutionCapabilitiesFixture({
        status: "proposed",
        submitted: true,
        overrides: {
          canApprove: {
            applicable: true,
            allowed: true,
            reasonCode: "ALLOWED",
            reason: "允许执行",
          },
        },
      }),
    });
    renderProcess();

    await user.click(await screen.findByRole("button", { name: "批准方案" }));
    await user.click(await screen.findByRole("button", { name: "确认批准" }));
    await waitFor(() => expect(calls).toContain("POST /api/v2/resolution-cases/resolution-fixture/approve"));
    await waitFor(() => expect(screen.getByTestId("process-step-approval")).toHaveAttribute("data-status", "done"));
    expect(await screen.findByText("方案已批准")).toBeInTheDocument();
  });

  it("disables execution when the backend denies the current role", async () => {
    mockGovernanceApi({
      initial: resolutionQueryFixture("approved"),
      capabilities: resolutionCapabilitiesFixture({
        status: "approved",
        overrides: {
          canExecute: {
            applicable: true,
            allowed: false,
            reasonCode: "ROLE_NOT_ALLOWED",
            reason: "当前角色没有执行已批准方案的权限",
          },
        },
      }),
    });
    renderProcess();

    expect(await screen.findByRole("button", { name: "执行已批准方案" })).toBeDisabled();
    expect(screen.getByText("当前角色没有执行已批准方案的权限")).toBeInTheDocument();
  });

  it("disables closure when the backend denies the current role", async () => {
    mockGovernanceApi({
      initial: resolutionQueryFixture("executed", { receipts: [resolutionReceiptFixture()] }),
      capabilities: resolutionCapabilitiesFixture({
        status: "executed",
        overrides: {
          canClose: {
            applicable: true,
            allowed: false,
            reasonCode: "ROLE_NOT_ALLOWED",
            reason: "当前角色没有核验结案的权限",
          },
        },
      }),
    });
    renderProcess();

    expect(await screen.findByRole("button", { name: "核验回执并结案" })).toBeDisabled();
    expect(screen.getByText("当前角色没有核验结案的权限")).toBeInTheDocument();
  });

  it("renders only assignable owner roles returned by the backend", async () => {
    mockGovernanceApi({
      initial: resolutionQueryFixture("triaged"),
      resolutionListEmpty: true,
      capabilities: resolutionCapabilitiesFixture({ ownerRoles: ["财务"] }),
    });
    renderProcess();

    const ownerRole = await screen.findByLabelText("处置负责人");
    expect(ownerRole).toHaveValue("财务");
    expect(screen.getByRole("option", { name: "财务" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "品质负责人" })).not.toBeInTheDocument();
  });

  it("disables owner assignment when the backend provides no assignable roles", async () => {
    mockGovernanceApi({
      initial: resolutionQueryFixture("triaged"),
      resolutionListEmpty: true,
      capabilities: resolutionCapabilitiesFixture({ ownerRoles: [] }),
    });
    renderProcess();

    expect(await screen.findByLabelText("处置负责人")).toBeDisabled();
    expect(screen.getByText("当前没有可指派负责人角色。")).toBeInTheDocument();
  });

  it("refreshes capabilities when the demo actor changes", async () => {
    const user = userEvent.setup();
    mockGovernanceApi({
      initial: resolutionQueryFixture("proposed", { submitted: true }),
      capabilitiesByActor: {
        "quality-owner": resolutionCapabilitiesFixture({
          status: "proposed",
          submitted: true,
          overrides: {
            canApprove: {
              applicable: true,
              allowed: false,
              reasonCode: "ROLE_NOT_ALLOWED",
              reason: "当前角色没有审批权限",
            },
          },
        }),
        "sales-director": resolutionCapabilitiesFixture({
          status: "proposed",
          submitted: true,
          overrides: {
            canApprove: {
              applicable: true,
              allowed: true,
              reasonCode: "ALLOWED",
              reason: "允许执行",
            },
          },
        }),
      },
    });
    renderProcess();

    expect(await screen.findByRole("button", { name: "批准方案" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "切换销售总监" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "批准方案" })).toBeEnabled());
    expect(screen.queryByText("当前角色没有审批权限")).not.toBeInTheDocument();
  });

  it("executes, shows receipts, then closes without conflating receipt with closure", async () => {
    const user = userEvent.setup();
    mockGovernanceApi({ initial: resolutionQueryFixture("approved") });
    renderProcess();

    const executeButton = await screen.findByRole("button", { name: "执行已批准方案" });
    expect(await screen.findByText("已授权")).toBeInTheDocument();
    await user.click(executeButton);
    await user.click(await screen.findByRole("button", { name: "确认执行" }));
    expect(await screen.findByText("1 条回执")).toBeInTheDocument();
    expect(await screen.findByText("回执表示执行结果已登记，治理仍需核验后结案。")).toBeInTheDocument();
    expect(screen.queryByText(/local-ledger/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "核验回执并结案" }));
    await user.click(await screen.findByRole("button", { name: "确认结案" }));
    expect(await screen.findByText("治理：已结案")).toBeInTheDocument();
  });

  it("renders outcome observations without causal attribution", async () => {
    mockGovernanceApi({
      initial: resolutionQueryFixture("closed", { receipts: [resolutionReceiptFixture()] }),
      outcomes: outcomeListFixture,
    });
    renderProcess();

    expect(await screen.findByText("目标达成")).toBeInTheDocument();
    expect(screen.getByText("结果测量证据")).toBeInTheDocument();
    expect(screen.getByText(/该测量用于观察后续业务状态/)).toBeInTheDocument();
    expect(screen.getByText("治理流程已结案，业务结果仍需以后续测量为准。")).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-19T/)).not.toBeInTheDocument();
    expect(screen.queryByText(/outcome-demo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Synthetic Outcome Evidence/)).not.toBeInTheDocument();
    expect(screen.queryByText(/verifiedReceiptDifference/)).not.toBeInTheDocument();
  });

  it("renders loading and local error states", async () => {
    mockGovernanceApi({ initial: resolutionQueryFixture("approved"), resolutionError: true });
    renderProcess();
    expect(await screen.findByText("治理进程加载失败")).toBeInTheDocument();
    cleanup();

    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderProcess();
    expect(screen.getByLabelText("加载中")).toBeInTheDocument();
  });

  it("disables duplicate execution clicks and shows mutation pending state", async () => {
    const calls = mockGovernanceApi({ initial: resolutionQueryFixture("approved"), holdExecution: true });
    renderProcess();
    const execute = await screen.findByRole("button", { name: "执行已批准方案" });
    fireEvent.click(execute);
    const confirm = await screen.findByRole("button", { name: "确认执行" });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(await screen.findByRole("button", { name: "正在执行..." })).toBeDisabled();
    expect(calls.filter((call) => call === "POST /api/v2/resolution-cases/resolution-fixture/execute")).toHaveLength(1);
  });
});
