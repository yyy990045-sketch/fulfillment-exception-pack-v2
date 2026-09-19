import { expect, test } from "@playwright/test";

test("manufacturing evidence workbench smoke", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/manufacturing/ctx-so-mfg-001");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(page.getByRole("heading", { name: "SO-MFG-001" })).toBeVisible();
  await expect(page.getByTestId("thread-stage")).toHaveCount(8);
  await expect(page.getByText("7 条规则评估")).toBeVisible();
  await expect(page.getByTestId("exception-item")).toHaveCount(4);

  await page.getByTestId("exception-item").filter({ hasText: "客户收货主张与发货记录不一致" }).click();
  const evidenceTab = page.getByRole("tab", { name: "Evidence" });
  await evidenceTab.click();
  await expect(evidenceTab).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("evidence-row")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "客户收货主张与发货记录不一致" })).toBeVisible();

  await page.getByTestId("evidence-row").filter({ hasText: "客户主张" }).click();
  await expect(page.getByTestId("evidence-inspector")).toContainText("客户主张收到");
});
