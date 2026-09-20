import { expect, test } from "@playwright/test";

test("analytics route reports an unconfigured analytics provider without a fake embed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "经营分析" })).toBeVisible();
  // e2e 环境没有配置任何分析 provider：必须显式说明"尚未配置"，不能伪造看板
  await expect(page.getByText("分析服务尚未配置")).toBeVisible();
  await expect(page.getByTestId("superset-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("powerbi-report")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全屏" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
