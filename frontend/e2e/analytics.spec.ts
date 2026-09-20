import { expect, test } from "@playwright/test";

test("analytics route exposes a real embed configuration state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "经营分析" })).toBeVisible();
  await expect(page.getByText("Power BI 尚未配置")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全屏" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
