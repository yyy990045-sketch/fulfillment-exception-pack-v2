# Phase 5B 城市配送最终收口

基线：重新 fetch 的 `main`，`3f0e37200d87887e2c2d1e83bb237d4ef744a586`。
分支：`fix/city-delivery-demo-closure`。验收日期：2026-10-11。

## Phase 5A 针对性核查

| 既有能力 | 本轮开始时判断 | 处理 |
| --- | --- | --- |
| 标准输入指纹 | 已实现且可用 | 真实接口与下载 JSON 核对，复用 |
| 计算结果来源 | 已实现且可用 | 保留 computed-per-request 和输入指纹 |
| 06 当前结果 | 已实现但存在缺陷 | 统一确认状态；无前后对照也显示当前结果；补门店、件数、返仓；不可执行基准不作节约依据 |
| SKU 转包装件 | 已实现但存在缺陷 | 使用当前任务的门店/车辆/矩阵，修复数值类型与整数数量校验 |
| 装卸业务摘要 | 部分完成 | 05 提供全部启用车辆与实际停靠顺序的完整作业单；按真实货物操作组织子步骤 |
| 已确认计划导出 | 已实现但存在缺陷 | 执行与导出共用确认/可执行/输入未变/无候选门禁；JSON 增补完整计算响应；增加可打印 HTML |

## 计划一致性

业务页面使用计算时的场景，编辑中的条件独立保存。改条件立即撤销当前确认与执行/导出资格，清除候选与播放状态。新结果仍需确认；接口失败时旧计划仅供查看。显式恢复旧计划时同时恢复其原始输入、指纹和确认状态。请求取消和序号检查阻止迟到结果覆盖新任务。

06 的可比基准仅取当前响应内通过可执行检查的 initialCheck，核对结果来源指纹；无有效基准只展示当前结果。历史案例另置折叠区，未以 scenarioId 将静态结果当作当前基准。

05 复用 placements、loadingSteps、unloading.steps、stopOrder 和站后剩余货物；不从货箱数组推导作业顺序。不可执行车辆显示原因，不交付安全卸货指引。HTML 下载后可用浏览器打印/保存 PDF，保留来源身份。

## 实际业务验收

- 六店：导入 → 真实规划 → 04 三维货位/确认/装车播放 → 05 完整卸货模拟 → JSON/HTML 下载 → 06 同计划结果，通过。
- 车辆可用性、出发时间、时间窗变化均撤销确认。12:00 出发未形成可执行计划，执行与导出被阻止；显式恢复原条件后恢复原计划。
- 改为 08:15 出发，真实重算得到新指纹，重新确认后 06 显示 09:23 返仓，通过。
- SKU：12 个商品、每箱 10 个，实际生成 1 整箱和 2 拆零件并规划；小数数量拒绝；新任务重新确认，通过。
- 四店：PLAN_A 12 km / 222 元受阻；PLAN_B 16 km / 236 元可执行；真实访问顺序修订，通过。
- 九店：冻结三车/两车方案仍可比较与演示；两车 38 km / 450.4 元保留。静态数据与当前计算隔离，通过。

六店主线实际结果：V02 启用，V01 空闲；6 店、12 件、320.5 kg；16 km；固定费用 150 元 + 行驶费用 44.8 元 = 194.8 元；68 分钟，09:08 返仓；装载与逐站卸货可执行，12 件各装卸一次，最终剩余 0 件。
计划 `PLAN-5b883a7e2c5a`，输入指纹 `302258d80464`。

## 验证与真实性边界

- `npm run typecheck`、`npm run frontend:test`（71 项）、`npm run frontend:build` 通过。
- `frontend/playwright.city-delivery.config.ts`：4 项真实 Chromium 浏览器验收通过；调整后新结果专项复核通过。
- `/health` 与实际标准规划接口通过；`verify.py` 对四店和九店的几何/唯一分配/逐步卸货回放通过。
- 冻结快照只兼容忽略已有两个空间占用展示字段，其他业务字段仍完整对照，原始几何检查与卸货回放保留。
- 实际下载 JSON/HTML，打印样张逐页检查。截图、下载文件和打印 PDF 位于本地 `test-results/`（不提交二进制证据）。
- v1/v2 原始数据、03 GIS、规划求解器、数据库和工业主线均未改动。
- **simulation only**：合成任务 + 本地真实计算服务 + 浏览器模拟，无企业现场/GPS/生产集成验证，不宣称全局最优或企业节约收益。

指定的 `C:/Users/EDY/.codex/skills/lean-mode/SKILL.md` 本机不存在，已搜索技能目录；按用户最小修复原则执行。复用已有检查与计算字段，仅补任务边界、异步失效和交付展示，不增加备用算法或大型导出框架。现有构建体积警告保留，本轮不扩展优化。

## Windows 复现

克隆时保留冻结文件字节（换行转换会影响保护哈希）：

```powershell
git -c core.autocrlf=false clone https://github.com/yyy990045-sketch/fulfillment-exception-pack-v2.git
cd fulfillment-exception-pack-v2
git config core.autocrlf false
npm ci
python -m venv ../city-delivery-venv
../city-delivery-venv/Scripts/python.exe -m pip install -r tools/city-delivery-decision/requirements.txt
$env:CITY_DELIVERY_PYTHON=(Resolve-Path ../city-delivery-venv/Scripts/python.exe).Path
npx playwright install chromium
npx playwright test --config frontend/playwright.city-delivery.config.ts
& $env:CITY_DELIVERY_PYTHON -X utf8 tools/city-delivery-decision/verify.py
```

本机使用 Codex 提供的 Python 3.12 在仓库外创建虚拟环境；Git 2.55、Node 24.20、npm 11.19、GitHub CLI 2.101。测试配置通过 env 属性设置 Windows 环境变量，未大规模改写 npm 启动脚本。无演示阻碍；完成后停止功能扩展，PR 等待 Owner 审查，不自动合并。
