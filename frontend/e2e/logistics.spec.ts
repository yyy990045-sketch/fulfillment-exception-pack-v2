import { expect, test, type Page } from '@playwright/test';

const routes = ['order', 'analysis', 'carriers', 'negotiation', 'solutions', 'plan', 'execution', 'exceptions', 'replan', 'results'];
// 11 实验结果页是研究结论页，不渲染 3D 网络；订单页用静态快照，其余页面都应有可用画布。
const canvasRoutes = routes.filter((route) => route !== 'order' && route !== 'results');
// 每页 h1 由 shell 按路由渲染，用它确认「路由真的切过去了」，而不是只看是否还存在一个 h1。
const titles: Record<string, string> = {
  twin: '仓库运行总览',
  order: '订单创建（需求输入）',
  analysis: '可行性分析（单体承运商）',
  carriers: '承运商画像',
  negotiation: '联营协商过程',
  solutions: '方案对比与选择',
  plan: '计划详情（下单）',
  execution: '执行监控（实时状态）',
  exceptions: '异常事件',
  replan: '重新规划',
  results: '实验结果',
};

// 侧边栏在 700px 以下收起为抽屉（见 logistics.css 的 max-width:700px 分支）。
const NARROW_BREAKPOINT = 700;
// 无头 Chromium 走 SwiftShader 软件光栅，3D 场景首帧比真实 GPU 慢一个数量级，
// 因此本文件对「等待渲染完成」的断言统一放宽；测试级超时也在用例内局部放大。
const RENDER = { timeout: 30_000 } as const;

const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) <= NARROW_BREAKPOINT;

// 桌面端侧边栏挂在 [data-slot="sidebar-inner"]，窄视口下则整体挂进 Radix 抽屉，
// 两种形态都带 data-sidebar="sidebar"，用它做统一锚点（桌面端的 .lg-sidebar 类在抽屉里不存在）。
const sidebarLink = (page: Page, path: string) => page.locator(`[data-sidebar="sidebar"] a[href="/frontend/${path}"]`);

/**
 * 通过真实侧边栏进入某一步。
 * 桌面端侧边栏常驻，只需等它挂载；窄视口下它是 Radix 抽屉，必须先点「打开导航」。
 * 同时断言路由与 h1 标题，避免「点了但没跳转」或「跳了但内容没换」被当成通过。
 */
async function goToStep(page: Page, path: string) {
  if (isNarrow(page)) {
    // 抽屉关闭带退出动画：先等上一轮抽屉卸载，避免点击落在正在关闭的抽屉上
    await page.locator('[data-sidebar="sidebar"]').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    await page.getByRole('button', { name: '打开导航' }).click();
  }
  const link = sidebarLink(page, path);
  await expect(link).toHaveCount(1, RENDER);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/frontend/${path}(\\?|$)`), RENDER);
  await expect(page.locator('h1')).toHaveText(titles[path] ?? '', RENDER);
}

/** 不经过侧边栏、直接落地某一步时，同样等待页面真正渲染完成。 */
async function landOn(page: Page, path: string) {
  await page.goto(`/frontend/${path}`);
  await expect(page).toHaveURL(new RegExp(`/frontend/${path}(\\?|$)`), RENDER);
  await expect(page.locator('h1')).toHaveText(titles[path] ?? '', RENDER);
}

test.describe('物流合成演示工作台', () => {
  test('十一页路由在当前视口可访问并保持无页面级溢出', async ({ page }) => {
    // 11 个页面逐个导航 + 每页等 3D 首帧，软件光栅下很慢；仅此一条用例放宽超时（不改全局配置）
    test.setTimeout(420_000);
    const narrow = isNarrow(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/frontend\/twin/, RENDER);

    // 01 数字孪生是全屏驾驶舱：窄视口下不渲染侧边栏与顶栏，无法从 01 直接跳走。
    // 因此窄视口从 02 订单页起步，桌面端仍走 01 → 02 的真实点击路径。
    if (narrow) await landOn(page, 'order');

    for (const [index, route] of routes.entries()) {
      if (!narrow || index > 0) await goToStep(page, route);
      await expect(page.locator('.lg-demo-footnote')).toContainText('SYNTHETIC DEMO');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (!narrow) {
        const layout = await page.evaluate(() => { const sidebar = document.querySelector('[data-slot="sidebar-inner"]')?.getBoundingClientRect(); const main = document.querySelector('.lg-main-column')?.getBoundingClientRect(); return { sidebarWidth: sidebar?.width ?? 0, mainX: main?.x ?? 0 }; });
        expect(layout.sidebarWidth).toBeGreaterThan(180);
        expect(layout.mainX).toBeGreaterThanOrEqual(180);
      }
      if (canvasRoutes.includes(route)) await expect(page.locator('canvas[data-renderer="three"]').first()).toBeVisible(RENDER);
      if (route === 'solutions') {
        const edit = page.getByRole('button', { name: '编辑需求' });
        const before = await edit.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
        expect(before.background).not.toBe('rgb(255, 255, 255)');
        await edit.click();
        const after = await edit.evaluate((element) => ({ text: element.textContent, background: getComputedStyle(element).backgroundColor }));
        expect(after.text).toContain('编辑需求');
        expect(after.background).not.toBe('rgb(255, 255, 255)');
      }
    }
  });

  test('订单页实际渲染 Three.js 网络并支持进入分析', async ({ page }) => {
    await page.goto('/frontend/order?still=1');
    await expect(page.getByRole('heading', { name: '订单创建（需求输入）' })).toBeVisible(RENDER);
    await expect(page.locator('canvas[data-renderer="three"]')).toBeVisible(RENDER);
    await expect(page.locator('canvas[data-ready="true"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '查看节点 嘉兴' })).toBeVisible(RENDER);
    await page.getByRole('link', { name: /确认并进入可行性分析/ }).first().click();
    await expect(page).toHaveURL(/\/frontend\/analysis/, RENDER);
    await expect(page.getByRole('heading', { name: '可行性分析（单体承运商）' })).toBeVisible(RENDER);
  });

  test('主流程可从协商进入方案、计划、执行、异常、重新规划与实验结果', async ({ page }) => {
    // 主流程要连续走 5 个 3D 页面，软件光栅下比默认 90s 慢很多，仅本用例放宽
    test.setTimeout(240_000);
    await page.goto('/frontend/negotiation?still=1');
    await page.getByRole('button', { name: '确认方案并继续' }).click();
    await expect(page.getByText('协商已确认')).toBeVisible(RENDER);

    // 05 → 06：方案对比页负责「确认方案并进入计划」
    await goToStep(page, 'solutions');
    await expect(page.getByRole('heading', { name: '方案对比与选择' })).toBeVisible(RENDER);
    const confirmSolution = page.getByRole('button', { name: /确认方案并进入计划/ });
    await expect(confirmSolution).toBeEnabled(RENDER);
    await confirmSolution.click();
    await expect(page).toHaveURL(/\/frontend\/plan/, RENDER);

    // 07 → 08：下单执行
    await page.getByRole('button', { name: /确认下单并执行/ }).click();
    await expect(page.getByText('执行中')).toBeVisible(RENDER);
    await goToStep(page, 'execution');
    await expect(page.getByRole('heading', { name: /执行监控/ })).toBeVisible(RENDER);
    await expect(page.locator('canvas[data-renderer="three"]').first()).toBeVisible(RENDER);

    // 08 → 09：异常事件
    await goToStep(page, 'exceptions');
    await expect(page.getByRole('heading', { level: 1, name: '异常事件' })).toBeVisible(RENDER);
    await expect(page.getByText('丁 → 丙').first()).toBeVisible(RENDER);
    await expect(page.getByRole('button', { name: /重新规划/ }).first()).toBeEnabled(RENDER);
    await page.getByRole('button', { name: /重新规划/ }).first().click();
    await expect(page).toHaveURL(/\/frontend\/replan/, RENDER);

    // 09 → 10：重新规划
    await expect(page.getByRole('heading', { level: 1, name: '重新规划' })).toBeVisible(RENDER);
    await expect(page.getByText('OLD PLAN')).toBeVisible(RENDER);
    await expect(page.getByText('NEW PLAN')).toBeVisible(RENDER);
    await expect(page.getByText('+0.7572')).toBeVisible(RENDER);
    await expect(page.getByText('+0.644')).toBeVisible(RENDER);
    await expect(page.getByText('达成 → 达成')).toBeVisible(RENDER);

    // 10 → 11：实验结果
    await page.getByRole('button', { name: /查看实验结果/ }).click();
    await expect(page).toHaveURL(/\/frontend\/results/, RENDER);
    await expect(page.getByRole('heading', { level: 1, name: '实验结果' })).toBeVisible(RENDER);
    await expect(page.getByText('99.93%').first()).toBeVisible(RENDER);
    await expect(page.getByText('17.5547')).toBeVisible(RENDER);
    // 恢复诚实性边界：B2 通过、C2 未通过都必须如实呈现（不能只显示正面结论）
    await expect(page.locator('.lg-criterion', { hasText: 'B2' })).toContainText('PASS', RENDER);
    await expect(page.locator('.lg-criterion', { hasText: 'C2' })).toContainText('FAIL', RENDER);
  });
});
