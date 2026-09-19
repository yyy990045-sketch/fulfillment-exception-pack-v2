import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { decisionFixture } from "../../test/fixtures/manufacturing.js";
import {
  outcomeListFixture,
  policyListFixture,
  resolutionQueryFixture,
  resolutionReceiptFixture,
} from "../../test/fixtures/governance.js";
import type { ResolutionCaseQueryView } from "./analysis-types.js";
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
} ) {
  let resolution = structuredClone(options.initial);
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const pathname = new URL(url, window.location.origin).pathname;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${pathname}`);
    if (method === "GET" && pathname.endsWith("/policy-evaluations")) return jsonResponse(policyListFixture(options.mode));
    if (method === "GET" && pathname.endsWith("/outcome-evaluations")) return jsonResponse(options.outcomes ?? outcomeListFixture);
    if (method === "GET" && pathname.endsWith("/resolution-cases")) {
      if (options.resolutionError) return jsonResponse({ error: "resolution_unavailable" }, 500);
      return jsonResponse({ contextId: "ctx-fixture", resolutionCases: [resolution.resolutionCase] });
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

function renderProcess() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <GovernanceProcess
          contextId="ctx-fixture"
          exceptionId="exception-claim"
          recommendation={decisionFixture}
          selectedOptionId="option-evidence"
        />
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

describe("governance process", () => {
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
  });

  it("shows approval requirements and the backend SoD rejection", async () => {
    const user = userEvent.setup();
    mockGovernanceApi({
      initial: resolutionQueryFixture("proposed", { submitted: true }),
      mode: "approval_required",
      sodError: true,
    });
    renderProcess();

    expect(await screen.findByText(/需要人工审批/)).toBeInTheDocument();
    expect(screen.getByText(/策略资格：需要人工审批/)).toBeInTheDocument();
    expect(screen.getByText(/审批来自 Resolution 状态机/)).toBeInTheDocument();
    expect(screen.getByText("总经理")).toBeInTheDocument();
    expect(screen.getByText(/复核人：品质负责人；方案提出人：工程师/)).toBeInTheDocument();
    expect(screen.getByTestId("process-step-outcome")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("process-step-outcome")).toHaveTextContent("已有后续测量");
    await user.click(screen.getByRole("button", { name: "批准方案" }));
    expect(await screen.findByText(/复核\/方案提出人与审批人必须分离/)).toBeInTheDocument();
  });

  it("executes, shows receipts, then closes without conflating receipt with closure", async () => {
    const user = userEvent.setup();
    mockGovernanceApi({ initial: resolutionQueryFixture("approved") });
    renderProcess();

    await user.click(await screen.findByRole("button", { name: "执行已批准方案" }));
    expect(await screen.findByText("1 条回执")).toBeInTheDocument();
    expect(await screen.findByText("回执成功表示内部执行结果已登记，不代表 Resolution 已结案。")).toBeInTheDocument();
    expect(screen.queryByText(/local-ledger/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "核验回执并结案" }));
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
    expect(screen.getByText(/该结果不证明因果关系/)).toBeInTheDocument();
    expect(screen.getByText("Resolution 已结案不等于业务结果已经达成。")).toBeInTheDocument();
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
    act(() => {
      fireEvent.click(execute);
      fireEvent.click(execute);
    });
    expect(await screen.findByRole("button", { name: "正在执行..." })).toBeDisabled();
    expect(calls.filter((call) => call === "POST /api/v2/resolution-cases/resolution-fixture/execute")).toHaveLength(1);
  });
});
