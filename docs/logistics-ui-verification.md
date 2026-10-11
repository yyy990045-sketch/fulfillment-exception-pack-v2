# 物流 UI 复刻验证记录

## 范围

本次 `/frontend/` Synthetic Demo 覆盖 11 个页面：

- `/frontend/twin`：仓库运行总览（全屏数字孪生驾驶舱）
- `/frontend/order`：订单创建与自然语言约束抽取
- `/frontend/analysis`：单体承运商可行性分析
- `/frontend/carriers`：承运商画像与私有约束
- `/frontend/negotiation`：联营协商与本地消息
- `/frontend/solutions`：方案对比与选择
- `/frontend/plan`：计划详情、单据与模拟下单
- `/frontend/execution`：执行监控、车辆列表和异常事件
- `/frontend/exceptions`：运输中断事件、影响运输段与 SLA 风险
- `/frontend/replan`：原计划 → 中断事件 → 新计划 的成本 / 时效 / SLA 对照
- `/frontend/results`：三类输入条件下的对照结果与研究口径边界

09 / 10 / 11 三个页面的数据来自前端本地合成研究数据（`exception-fixtures.ts`），与 08 执行监控共用同一套节点坐标，保证 08 → 09 → 10 的 3D 网络拓扑连续。

## 技术与真实性边界

- 地形、路线、节点、车辆由 Three.js 实时生成；地图组件支持旋转、平移、缩放、视角切换、节点拾取、车辆沿线移动和 WebGL 错误提示。
- shadcn/ui 官方 registry 组件用于 Card、Dialog、DropdownMenu、Field、Input、Label、Select、Sidebar、Table、Textarea、Tooltip 等通用控件。
- Motion 用于页面切换，react-hook-form + Zod 用于订单字段校验，lucide-react 用于图标。
- 数据为本地合成演示，不连接真实承运商、GPS、路况、报价或交易系统；页面持续显示 `SYNTHETIC DEMO`。
- 原 `/manufacturing/`、`/operations`、`/analytics`、`/workspace` 和 `/demo/judge` 入口保留。

## 自动化结果

执行日期：2026-10-06

- `npm run typecheck`：通过
- `npm run frontend:test`：通过，10 个测试文件、68 个测试
- `npm run frontend:build`：通过
- `npm test -- tests/frontend-http.test.ts tests/frontend-authorization-boundary.test.ts`：通过，4 个测试
- `npm run frontend:e2e:logistics`：通过；桌面 1440x900 与手机 390x844 均覆盖 11 页路由、Three.js canvas、主流程（协商 → 方案 → 计划 → 执行 → 异常 → 重新规划 → 实验结果）与页面级溢出。窄视口下侧边栏是抽屉，用例会先展开侧边栏再点击，且逐页断言 h1 标题以保证路由真的切换
- `npm run frontend:e2e`：通过，6 个原有制造/分析/运营回归测试
- `git diff --check`：通过
- `curl http://127.0.0.1:8097/frontend/`：HTTP 200，`text/html`
- `curl http://127.0.0.1:8097/frontend/order`：HTTP 200，`text/html`

## 浏览器检查

已在本地浏览器实际检查：

- 1440x900：11 页均能加载，页面级 `scrollWidth === innerWidth`，Three.js 画布实际生成并完成渲染标记。
- 390x844：11 页均能加载，页面级无横向溢出；长表格和步骤轨道仅在内部容器滚动。
- 画布数量：订单/协商/方案/计划各 1 个，分析/画像/执行包含地图和车辆模型各 2 个。
- 入口与页面运行时无未处理错误；WebGL 上下文丢失有页面内错误状态。

11 页逐页截图存放于 `artifacts/frontend-final/`（`01_twin.png` … `11_results.png`，每页一张、非拼图）。
截图为把视口拉高到整页高度后按视口捕获，因此既包含整页内容，也不会出现 fixed 侧边栏在整页截图模式下的错位。
页面结构、画布实际渲染、路由、交互和响应式数据均由浏览器与 Playwright 检查完成。

30 秒演示动线在真实 GPU 窗口下实测：01 → 02 → 03 → 05 → 06 → 08 → 09 → 10，约 30 秒自动结束，全程不进入 11 实验结果页。
注意该动线由 1 秒定时器驱动，无头浏览器的定时器节流会让它明显慢于 30 秒，因此时长核验必须在真实窗口下进行。

## 已知差异

参考图中没有提供原始地形材质、真实地理数据、货车模型或品牌字体。本实现使用程序化 Three.js 地形、路线和货车网格，复刻深蓝黑面板、蓝色主路径、节点发光、红色异常、橙/紫方案区分及整体布局，不承诺源素材不可获得部分的像素级一致。

构建输出提示 Three.js 相关 chunk 超过 500 kB；这是当前直接使用 Three.js 与后处理的体积提示，不影响构建或运行，本轮未进行拆包改造。
