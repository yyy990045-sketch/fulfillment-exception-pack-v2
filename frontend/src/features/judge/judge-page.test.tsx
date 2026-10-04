import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { JudgePage } from "./pages/judge-page.js";
import type { JudgeManifestView } from "./types.js";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function manifest(overrides: Partial<JudgeManifestView> = {}): JudgeManifestView {
  return {
    schemaVersion: "judge-evidence-manifest/v1",
    generatedAt: "2026-09-21T00:00:00.000Z",
    scenario: "production-shortfall",
    scenarioLabel: "生产短少：工单完工 96 < 订单 100",
    businessQuestion: "订单承诺 100 件，MES 已完成 96 件；订单事实与来源系统保持可回溯。如何从 ERP/MES 等跨系统数据中自动发现差异，给出可回源证据，并推动异常完成治理闭环？",
    industrialContext: {
      enterpriseId: "demo-manufacturing",
      siteId: "factory-shanghai-01",
      areaId: "assembly-workshop",
      lineId: "line-a",
      equipmentIds: ["machine-a01"],
      unsRootPath: "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a",
    },
    businessFacts: { orderedQuantity: 100, productionCompletedQuantity: 96, difference: 4, unit: "pcs" },
    sources: {
      order: {
        role: "order", systemKey: "ERP-DEMO", systemType: "erp", evidenceId: "evidence-order",
        sourceDocumentId: "doc-order", field: "qty", value: 100, valueType: "number",
        observedAt: "2026-09-01T01:00:00.000Z",
        unsTopic: "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/sales/SO-IND-002/order.created",
        rawHash: "a".repeat(64),
      },
      production: {
        role: "production", systemKey: "MES-DEMO", systemType: "mes", evidenceId: "evidence-production",
        sourceDocumentId: "doc-production", field: "completedQty", value: 96, valueType: "number",
        observedAt: "2026-09-03T01:00:00.000Z",
        unsTopic: "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/production/MO-IND-002/production.completed",
        rawHash: "b".repeat(64),
      },
    },
    uns: {
      orderTopic: "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/sales/SO-IND-002/order.created",
      productionTopic: "enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/production/MO-IND-002/production.completed",
      topicConvention: "enterprise/{enterpriseId}/site/{siteId}/area/{areaId}/line/{lineId}/{domain}/{entityId}/{eventType}",
    },
    evidence: { orderEvidenceId: "evidence-order", productionEvidenceId: "evidence-production", totalCount: 2 },
    rule: { code: "MANUFACTURING.ORDER_PRODUCTION_COMPLETION_SHORTFALL", result: "matched", expected: 100, actual: 96, difference: 4 },
    exception: {
      id: "exc-1", code: "ORDER_PRODUCTION_COMPLETION_SHORTFALL", severity: "medium",
      title: "生产完成数量低于订单数量", summary: "订单数量 100，累计生产完成数量 96，差异 4。",
    },
    governance: {
      status: "executed", stage: "executed", caseId: "resolution-case-exc-1", ownerRole: "品质负责人",
      proposedBy: "工程师", approvedBy: "总经理", segregationOfDutiesEnforced: true,
    },
    execution: { status: "verified", downstream: "simulated-mes", receiptId: "receipt-1", mismatches: [], apiWriteIsNotBusinessCompletion: true },
    outcome: { status: "target_met", definitionId: "outcome-order-production-shortfall-closed", baseline: 4, current: 0, target: 0, causalAttribution: false },
    ai: {
      provider: "decision-deterministic-demo", model: "decision-fixture-v1", recommendationId: "drec-1",
      recommendationStatus: "generated", humanDecisionRequired: true, canApprove: false, canExecute: false,
      note: "AI 只提供解释与候选动作；审批与执行必须由人完成。",
    },
    trace: { status: "EVIDENCE_TRACE_VERIFIED", failures: [], hops: ["exception", "evidence"], evidenceLinks: 2, payloadSourcePath: ".preview/judge-demo/uns-stream.jsonl" },
    truthBoundary: { simulatedIndustrialEnvironment: true, realFactoryVerified: false },
    artifacts: { unsStream: "uns-stream.jsonl", evidenceManifest: "evidence.json", readback: "execution-readback.json" },
    ...overrides,
  };
}

function mockApi(body: JudgeManifestView | number) {
  vi.stubGlobal("fetch", vi.fn(() => (
    typeof body === "number" ? jsonResponse({ error: "not_found" }, body) : jsonResponse(body)
  )));
}

/** 摘要条是 <dl aria-label>；直接用选择器取，避免 testing-library 的标签查询歧义。 */
function summary(label: string) {
  const element = document.querySelector(`dl[aria-label="${label}"]`);
  if (!element) throw new Error(`summary strip not found: ${label}`);
  return within(element as HTMLElement);
}

function renderPage(initialEntry = "/demo/judge") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/demo/judge" element={<JudgePage />} />
          </Routes>
        </MemoryRouter>
      </DemoSettingsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  // vitest 未开 globals，testing-library 不会自动清理：不清会读到上一个用例的 DOM
  cleanup();
  vi.unstubAllGlobals();
});

describe("评委视图（只读聚合）", () => {
  it("第一屏是业务语言：工业位置、业务问题、关键事实、证据来源", async () => {
    mockApi(manifest());
    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { name: "比赛评委视图" })).toBeInTheDocument());
    expect(screen.getByText(/订单承诺 100 件/)).toBeInTheDocument();
    expect(screen.getByText("demo-manufacturing")).toBeInTheDocument();
    expect(screen.getByText("factory-shanghai-01")).toBeInTheDocument();
    expect(screen.getByText("line-a")).toBeInTheDocument();
    expect(screen.getByTestId("judge-truth-boundary")).toHaveTextContent("不是真实工厂");

    const facts = summary("关键事实明细");
    expect(facts.getByText("订单承诺")).toBeInTheDocument();
    expect(facts.getByText("100")).toBeInTheDocument();
    expect(facts.getByText("MES 实际完工")).toBeInTheDocument();
    expect(facts.getByText("96")).toBeInTheDocument();
    expect(facts.getByText("差异")).toBeInTheDocument();
    expect(facts.getByText("4")).toBeInTheDocument();

    expect(screen.getByText(/ERP-DEMO（erp）/)).toBeInTheDocument();
    expect(screen.getByText(/MES-DEMO（mes）/)).toBeInTheDocument();
    expect(screen.getByText("qty = 100")).toBeInTheDocument();
    expect(screen.getByText("completedQty = 96")).toBeInTheDocument();
  });

  it("异常、处理进度与最终结果一眼可见，技术细节折叠在 details 里", async () => {
    mockApi(manifest());
    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { name: "规则判定与异常" })).toBeInTheDocument());
    const exceptionSection = screen.getByRole("heading", { name: "规则判定与异常" }).closest("section")!;
    expect(within(exceptionSection).getByText("ORDER_PRODUCTION_COMPLETION_SHORTFALL")).toBeInTheDocument();
    expect(within(exceptionSection).getByText(/MANUFACTURING\.ORDER_PRODUCTION_COMPLETION_SHORTFALL/)).toBeInTheDocument();
    expect(within(exceptionSection).getByText(/判定 matched/)).toBeInTheDocument();

    const progress = summary("处理进度明细");
    expect(progress.getByText("executed")).toBeInTheDocument();
    expect(progress.getByText("verified")).toBeInTheDocument();
    expect(progress.getByText("target_met")).toBeInTheDocument();
    expect(progress.getByText("EVIDENCE_TRACE_VERIFIED")).toBeInTheDocument();

    // 技术元数据默认折叠在 <details> 里（未展开），而不是塞在第一屏
    const aiDetails = screen.getByText("查看 AI 角色与执行回读细节").closest("details")!;
    expect(aiDetails.hasAttribute("open")).toBe(false);
    expect(aiDetails).toHaveTextContent("drec-1");
    const unsDetails = screen.getByText("查看 UNS topic 与留存载荷").closest("details")!;
    expect(unsDetails.hasAttribute("open")).toBe(false);
    expect(unsDetails).toHaveTextContent("enterprise/demo-manufacturing/site/factory-shanghai-01");
  });

  it("证据不可回源时，页面明确显示审批与执行已被闸门阻止", async () => {
    mockApi(manifest({
      trace: {
        status: "EVIDENCE_NOT_VERIFIABLE",
        failures: ["evidence-production:raw_hash.match"],
        hops: ["exception", "evidence", "raw_hash"],
        evidenceLinks: 2,
        payloadSourcePath: ".preview/judge-demo/uns-stream.jsonl",
      },
      governance: { status: "EVIDENCE_NOT_VERIFIABLE", stage: "not_started", caseId: null, ownerRole: null, proposedBy: null, approvedBy: null, segregationOfDutiesEnforced: true },
      execution: { status: "blocked", downstream: null, receiptId: null, mismatches: [], apiWriteIsNotBusinessCompletion: true },
      outcome: { status: "blocked_by_traceability_gate", definitionId: null, baseline: 4, current: null, target: null, causalAttribution: false },
    }));
    renderPage();

    const blocked = await screen.findByTestId("judge-gate-blocked");
    expect(blocked).toHaveTextContent("审批与执行已被闸门阻止");
    expect(within(blocked).getByText("evidence-production:raw_hash.match")).toBeInTheDocument();
    const progress = summary("处理进度明细");
    // 治理状态与证据回源状态这时都是 EVIDENCE_NOT_VERIFIABLE
    expect(progress.getAllByText("EVIDENCE_NOT_VERIFIABLE")).toHaveLength(2);
    expect(progress.getByText("blocked")).toBeInTheDocument();
    expect(progress.getByText("blocked_by_traceability_gate")).toBeInTheDocument();
  });

  it("接口不可用时给出明确指引，而不是空白页", async () => {
    mockApi(404);
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("评委视图不可用"));
    expect(screen.getByRole("alert")).toHaveTextContent("npm run demo:judge");
  });
});
