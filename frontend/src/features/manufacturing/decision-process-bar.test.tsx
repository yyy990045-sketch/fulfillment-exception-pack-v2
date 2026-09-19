import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoSettingsProvider } from "../../app/demo-settings.js";
import { DecisionProcessBar } from "./components/decision-process-bar.js";

function renderBar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DemoSettingsProvider>
        <DecisionProcessBar contextId="ctx-fixture" exceptionId="exception-claim" />
      </DemoSettingsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Decision process bar query state", () => {
  it("shows a neutral loading state without pretending the current step is 建议", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderBar();
    const bar = screen.getByTestId("decision-process-bar");
    expect(bar).toHaveAttribute("data-state", "loading");
    expect(bar).not.toHaveAttribute("data-current-step");
    expect(bar).toHaveTextContent("正在读取治理状态");
    expect(bar.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("shows a neutral error state without pretending a recommendation exists", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "unavailable" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }))));
    renderBar();
    const bar = await screen.findByTestId("decision-process-bar");
    await waitFor(() => expect(bar).toHaveAttribute("data-state", "error"));
    expect(bar).not.toHaveAttribute("data-current-step");
    expect(bar).toHaveTextContent("治理状态暂不可用");
    expect(bar.querySelector('[aria-current="step"]')).toBeNull();
  });
});
