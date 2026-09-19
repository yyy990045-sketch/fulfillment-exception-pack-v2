import { expect, test } from "@playwright/test";

test("manufacturing evidence workbench smoke", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/manufacturing/ctx-so-mfg-001");
    await expect(page.getByRole("heading", { name: "SO-MFG-001" })).toBeVisible();
    await expect(page.getByTestId("digital-thread-track")).toBeVisible();
    const layout = await page.evaluate(() => {
      const context = document.querySelector('[data-testid="context-header"]')?.getBoundingClientRect();
      const thread = document.querySelector('[data-testid="digital-thread-track"]') as HTMLElement | null;
      const selected = document.querySelector('[data-testid="selected-exception-header"]')?.getBoundingClientRect();
      return {
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        threadFits: Boolean(thread && thread.scrollWidth <= thread.clientWidth + 1),
        contextAligned: Boolean(context && context.top >= 56 && context.top < 80),
        selectedInFirstViewport: Boolean(selected && selected.top < window.innerHeight && selected.bottom < window.innerHeight),
      };
    });
    expect(layout).toEqual({
      noPageOverflow: true,
      threadFits: true,
      contextAligned: true,
      selectedInFirstViewport: true,
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
});
