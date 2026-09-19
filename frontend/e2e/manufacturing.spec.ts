import { expect, test } from "@playwright/test";

const desktopViewports = [
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
];

test("manufacturing evidence workbench smoke", async ({ page }) => {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/manufacturing/ctx-so-mfg-001");
    await expect(page.getByRole("heading", { name: "SO-MFG-001" })).toBeVisible();
    await expect(page.getByTestId("digital-thread-track")).toBeVisible();
    const layout = await page.evaluate(() => {
      const context = document.querySelector('[data-testid="context-header"]')?.getBoundingClientRect();
      const thread = document.querySelector('[data-testid="digital-thread-track"]') as HTMLElement | null;
      const selected = document.querySelector('[data-testid="selected-exception-header"]')?.getBoundingClientRect();
      const workspace = document.querySelector('[role="tablist"]')?.getBoundingClientRect();
      return {
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        threadFits: Boolean(thread && thread.scrollWidth <= thread.clientWidth + 1),
        contextAligned: Boolean(context && context.top >= 56 && context.top < 80),
        selectedInFirstViewport: Boolean(selected && selected.top < window.innerHeight && selected.bottom < window.innerHeight),
        workspaceInFirstViewport: Boolean(workspace && workspace.top < window.innerHeight),
      };
    });
    expect(layout).toEqual({
      noPageOverflow: true,
      threadFits: true,
      contextAligned: true,
      selectedInFirstViewport: true,
      workspaceInFirstViewport: true,
    });
    const ruleIds = await page.getByTestId("rule-chip").evaluateAll((items) => items.map((item) => item.getAttribute("data-rule-id")));
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText.includes("sales_order")).toBe(false);
    expect(visibleText).toContain("示例制造企业");
    expect(visibleText).not.toContain("演示身份");
    await expect(page.getByLabel("账户与设置")).toBeVisible();
    await page.getByRole("tab", { name: "决策" }).click();
    const processBar = page.getByTestId("decision-process-bar");
    await expect(processBar).toBeVisible();
    const processBox = await processBar.boundingBox();
    expect(processBox).not.toBeNull();
    expect(processBox!.y).toBeLessThan(viewport.height);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/manufacturing/ctx-so-mfg-001");

  await expect(page.getByRole("heading", { name: "SO-MFG-001" })).toBeVisible();
  await expect(page.getByTestId("thread-stage")).toHaveCount(8);
  await expect(page.getByText("7 条唯一规则评估")).toBeVisible();
  await expect(page.getByTestId("exception-item")).toHaveCount(4);
  await page.getByLabel("搜索异常").fill("发货");
  await expect(page.getByTestId("exception-item")).toHaveCount(2);
  await expect(page.getByText("2 / 4")).toBeVisible();
  await page.getByLabel("搜索异常").fill("");

  await page.getByTestId("exception-item").filter({ hasText: "客户收货主张与发货记录不一致" }).click();
  const evidenceTab = page.getByRole("tab", { name: "证据" });
  await evidenceTab.click();
  await expect(evidenceTab).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("evidence-row")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "客户收货主张与发货记录不一致" })).toBeVisible();

  await page.getByTestId("evidence-row").filter({ hasText: "客户主张" }).click();
  await expect(page.getByTestId("evidence-inspector")).toContainText("客户主张收到");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("evidence-inspector")).toBeHidden();

  await page.getByRole("tab", { name: "分析" }).click();
  await expect(page).toHaveURL(/\/analysis$/);
  await expect(page.getByRole("heading", { name: "AI 解释" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "根因假设" })).toBeVisible();
  await expect(page.getByText("暂无生成结果")).toHaveCount(2);

  await page.getByRole("link", { name: "查看决策建议" }).click();
  await expect(page).toHaveURL(/\/decision$/);
  const processBar = page.getByTestId("decision-process-bar");
  await expect(processBar).toBeVisible();
  await expect(processBar).toContainText("当前步骤");
  const processBox = await processBar.boundingBox();
  expect(processBox).not.toBeNull();
  expect(processBox!.y).toBeLessThan(900);
  await expect(page.getByRole("heading", { name: "决策建议" })).toBeVisible();
  await expect(page.getByText("暂无生成结果")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/analysis$/);

  await page.getByRole("link", { name: "运营视图" }).click();
  await expect(page).toHaveURL(/\/operations/);
  await expect(page.getByRole("heading", { name: "运营视图" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "业务上下文组合" })).toBeVisible();
  await page.getByRole("button", { name: "SO-MFG-001" }).first().click();
  await expect(page).toHaveURL(/\/manufacturing\/ctx-so-mfg-001/);

  await page.getByRole("link", { name: "方案包" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.getByRole("heading", { name: "方案包", exact: true })).toBeVisible();
  await expect(page.getByText("Manufacturing Fulfillment").first()).toBeVisible();
});

test("operations and solution pack keep product-shell density across desktop sizes", async ({ page }) => {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);

    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: "运营视图" })).toBeVisible();
    await expect(page.getByTestId("operations-portfolio-table")).toBeVisible();
    const operationsHeading = await page.getByRole("heading", { name: "运营视图" }).boundingBox();
    const operationsTable = await page.getByTestId("operations-portfolio-table").boundingBox();
    expect(operationsHeading?.y ?? Infinity).toBeLessThan(160);
    expect(operationsTable?.y ?? Infinity).toBeLessThan(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const operationsText = await page.locator("body").innerText();
    expect(operationsText).not.toMatch(/\b(?:high|medium|low|critical|pending_approval|target_met)\b/);

    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "方案包", exact: true })).toBeVisible();
    await expect(page.getByText("Manufacturing Fulfillment").first()).toBeVisible();
    const workspaceHeading = await page.getByRole("heading", { name: "方案包", exact: true }).boundingBox();
    expect(workspaceHeading?.y ?? Infinity).toBeLessThan(160);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const workspaceText = await page.locator("body").innerText();
    expect(workspaceText).not.toContain("示例数据");
    expect(workspaceText).not.toMatch(/\b(?:high|medium|low|critical)\b/);
  }
});

test("generic finance workspace uses the same product shell without enum leaks", async ({ page }) => {
  await page.route("**/api/v2/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-tenant-id": "demo-finance",
      },
    });
  });

  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/workspace/ctx-fin-rec-001");
    await expect(page.getByRole("heading", { name: "REC-FIN-001" })).toBeVisible();
    await expect(page.getByText(/财务对账上下文/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "规则评估" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "异常" })).toBeVisible();
    const heading = await page.getByRole("heading", { name: "REC-FIN-001" }).boundingBox();
    const rules = await page.getByRole("heading", { name: "规则评估" }).boundingBox();
    expect(heading?.y ?? Infinity).toBeLessThan(160);
    expect(rules?.y ?? Infinity).toBeLessThan(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/\b(?:high|medium|low|critical)\b/);
    expect(visibleText).not.toContain("Business Thread");
    expect(visibleText).not.toContain("示例数据");
  }
});

test("commercial governance flow confirms high-impact actions and reports success", async ({ page }) => {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/manufacturing/ctx-so-ops-006");
    await expect(page.getByRole("heading", { name: "SO-OPS-006" })).toBeVisible();
    await page.getByRole("tab", { name: "决策" }).click();
    await expect(page.getByRole("heading", { name: "处理进程" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("账户与设置").click();
  await page.getByLabel("切换业务角色").selectOption("sales-director");
  await page.keyboard.press("Escape");

  const governanceText = await page.locator("body").innerText();
  expect(governanceText).not.toMatch(/\b(?:Resolution|SoD|runtime|backend|Policy|provider|internal)\b/i);
  expect(governanceText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(governanceText).not.toMatch(/Synthetic|sample|本地演示/);

  const executionStep = page.getByTestId("process-step-execution");
  const executeAction = executionStep.getByRole("button", { name: "执行已批准方案", exact: true });
  if (!(await executeAction.isVisible().catch(() => false))) {
    await executionStep.getByRole("button").first().click();
  }
  await executeAction.click();
  const executeConfirmation = page.getByTestId("governance-confirmation-sheet");
  await expect(executeConfirmation).toBeVisible();
  await expect(executeConfirmation).toContainText("SO-OPS-006");
  await expect(executeConfirmation).toContainText("执行已批准方案");
  await expect(executeConfirmation).toContainText("销售总监");
  await executeConfirmation.getByRole("button", { name: "确认执行" }).click();
  await expect(page.getByText("执行结果已登记")).toBeVisible();

  const receiptStep = page.getByTestId("process-step-receipt");
  const closeAction = receiptStep.getByRole("button", { name: "核验回执并结案", exact: true });
  if (!(await closeAction.isVisible().catch(() => false))) {
    await receiptStep.getByRole("button").first().click();
  }
  await closeAction.click();
  await expect(page.getByTestId("governance-confirmation-sheet")).toContainText("确认核验并结案");
  await page.getByTestId("governance-confirmation-sheet").getByRole("button", { name: "确认结案" }).click();
  await expect(page.getByText("治理已结案")).toBeVisible();
});
