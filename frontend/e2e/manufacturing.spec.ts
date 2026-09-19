import { expect, test } from "@playwright/test";

const desktopViewports = [
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
];

test("manufacturing list and record surfaces hold across desktop sizes", async ({ page }) => {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);

    await page.goto("/manufacturing/ctx-so-mfg-001");
    await expect(page.getByRole("heading", { name: "SO-MFG-001" })).toBeVisible();
    await expect(page.getByTestId("digital-thread-track")).toBeVisible();
    await expect(page.getByTestId("exception-queue-table")).toBeVisible();
    await expect(page.getByTestId("selected-exception-header")).toHaveCount(0);
    await expect(page.getByRole("tablist")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByTestId("exception-item").first().click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByTestId("selected-exception-header")).toBeVisible();
    await expect(page.getByTestId("exception-queue-table")).toHaveCount(0);
    await expect(page.getByTestId("thread-stage")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "异常记录工作面" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(/\/manufacturing\/ctx-so-mfg-001$/);
    await expect(page.getByTestId("exception-queue-table")).toBeVisible();
  }
});

test("manufacturing task routes separate facts, analysis, decision, and governance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/operations");
  await page.getByRole("button", { name: "SO-MFG-001" }).first().click();
  await expect(page).toHaveURL(/\/manufacturing\/ctx-so-mfg-001$/);
  await page.getByLabel("搜索异常").fill("客户收货");
  await expect(page.getByTestId("exception-item")).toHaveCount(1);
  await page.getByTestId("exception-item").click();

  await expect(page).toHaveURL(/\/overview\?q=/);
  await expect(page.getByText("核心差异")).toBeVisible();
  await expect(page.getByTestId("evidence-row")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "处理进程" })).toHaveCount(0);

  await page.getByRole("link", { name: "证据", exact: true }).click();
  await expect(page).toHaveURL(/\/evidence\?q=/);
  await expect(page.getByTestId("evidence-row")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "AI 解释" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "处理进程" })).toHaveCount(0);

  await page.getByRole("link", { name: "分析", exact: true }).click();
  await expect(page).toHaveURL(/\/analysis\?q=/);
  await expect(page.getByRole("heading", { name: "AI 解释" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "根因假设" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "处理进程" })).toHaveCount(0);

  await page.getByRole("link", { name: "决策", exact: true }).click();
  await expect(page).toHaveURL(/\/decision\?q=/);
  await expect(page.getByRole("heading", { name: "决策建议" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "处理进程" })).toHaveCount(0);

  await page.getByRole("link", { name: "治理", exact: true }).click();
  await expect(page).toHaveURL(/\/governance\?q=/);
  await expect(page.getByRole("heading", { name: "处理进程" })).toBeVisible();
  await expect(page.getByText("当前阶段", { exact: true })).toHaveCount(2);

  await page.getByRole("link", { name: /返回 SO-MFG-001 异常队列/ }).click();
  await expect(page).toHaveURL(/\/manufacturing\/ctx-so-mfg-001\?q=/);
  await expect(page.getByLabel("搜索异常")).toHaveValue("客户收货");
  await expect(page.getByTestId("exception-item")).toHaveCount(1);
});

test("operations, solution pack, and finance workspace keep the shared product shell", async ({ page }) => {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);

    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: "运营视图" })).toBeVisible();
    await expect(page.getByTestId("operations-portfolio-table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "方案包", exact: true })).toBeVisible();
    await expect(page.getByText("Manufacturing Fulfillment").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.route("**/api/v2/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-tenant-id": "demo-finance",
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workspace/ctx-fin-rec-001");
  await expect(page.getByRole("heading", { name: "REC-FIN-001" })).toBeVisible();
  await expect(page.getByText(/财务对账上下文/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("manufacturing governance confirms high-impact actions and reports success", async ({ page }) => {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/manufacturing/ctx-so-ops-006");
    await page.getByTestId("exception-item").first().click();
    await page.getByRole("link", { name: "治理", exact: true }).click();
    await expect(page.getByRole("heading", { name: "处理进程" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/manufacturing/ctx-so-ops-006");
  await page.getByLabel("账户与设置").click();
  await page.getByLabel("切换业务角色").selectOption("sales-director");
  await page.getByTestId("exception-item").first().click();
  await page.getByRole("link", { name: "治理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "处理进程" })).toBeVisible();

  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(/\b(?:Resolution|SoD|runtime|backend|Policy|provider|internal)\b/i);
  expect(visibleText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(visibleText).not.toMatch(/Synthetic|sample|本地演示/);

  const executionStep = page.getByTestId("process-step-execution");
  const executeAction = executionStep.getByRole("button", { name: "执行已批准方案", exact: true });
  if (!(await executeAction.isVisible().catch(() => false))) {
    await executionStep.getByRole("button").first().click();
  }
  await executeAction.click();
  const executeConfirmation = page.getByTestId("governance-confirmation-sheet");
  await expect(executeConfirmation).toBeVisible();
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
