# Phase 7B：标准规划最大路线时长修复

2026-10-11，基于尚未合并的 PR #2 分支 `feat/city-delivery-real-3d-gis`，完整业务基线 `fd7b8dea2bcd48dd1c88c93ecf131d9af3c5314d`。本轮仅修复标准 v3 的最大路线时长漏检及必要回归，不修改有限搜索、候选排序、首次可行停止、货位候选、GIS或前端产品逻辑。

## 根因及最小修复

修复前通过真实 `/api/city-delivery/plan-scene` 重现 T12：1店1车1件，08:00出发，窗口08:00–13:00，服务0分钟，去程250分钟、返仓250分钟，共500分钟，声明上限480分钟。三个策略提交指定路线时均返回 FEASIBLE / executable=true；无指定路线时均正确拒绝。

`plan_standard` 接收指定路线后跳过 `solve` 的 TimeSeconds 限制，原最终评估只检验门店窗口，没有检验完整任务时长。现在在 **`standard.py::evaluate_routes`** 中，对每辆启用车辆的 `totalDurationMinutes` 与 `rules.maxRouteDurationMinutes` 比较，覆盖初次指定路线、自动规划、货位修订和联合反馈，以及货位搜索失败时仍需报告路线问题的分支。

总任务时长沿用既有计算语义：出发至各门店行驶＋提前到站等待＋服务＋返仓。超限时车辆与计划级可执行性均为 false，结构化原因包含：

```json
{"type":"max_route_duration","vehicleId":"V01","actualDurationMinutes":500,"maxRouteDurationMinutes":480,"excessMinutes":20}
```

`solverStatus` 沿用 SEARCH_EXHAUSTED 等现有状态，实际可执行费用为空；业务超限仍返回 HTTP 200，不伪装为 INPUT_INVALID。授权联合反馈如果找到真正合法的新路线，仍按原规则接受。空闲车辆不产生虚假超限。

`decision.py`、`build_demo.py` 未改，历史 v1/v2 契约保持。前端仅新增状态回归测试，并修正基线 GIS 测试中闭包赋值导致 `split` 被推断为 `never` 的类型错误；后一项改为稳定后直接读取 DOM 相机状态，没有改变地图或界面。

## 独立边界与状态验收

在既有 `verify_v3.py` 中补充 Decimal 算术复核，从原始输入矩阵、窗口和服务时间逐站计算到返仓；不调用 `route_result` 或修复后的评估函数作为期望值。

| 检查 | 独立时长／条件 | 三策略结果 |
|---|---|---|
| A | 479.99分钟 | FEASIBLE，允许 |
| B | 480分钟 | FEASIBLE，允许 |
| C | 480.01分钟 | SEARCH_EXHAUSTED，不可执行，实际可执行费用为空 |
| D / I | 原T12指定路线500分钟 | 同 C；车辆与计划均有 max_route_duration |
| E | 行驶400＋等待40＋服务41＝481分钟 | 拒绝 |
| F | 到店250分钟未超限，返仓再251＝501分钟 | 拒绝 |
| G | 两辆启用车分别500与40分钟 | 超限车拒绝，另一车合法，整份计划不可执行 |
| H | 合法480分钟路线＋未用车辆 | 计划允许，未用车0分钟、0费用、无超限原因 |
| J | T12无指定路线，自动规划 | 三策略原有正确拒绝保留 |
| K | 指定510分钟路线；反向访问100分钟合法 | A/B拒绝；授权C找到新合法路线并接受 |
| L | 同时货位失败和500分钟超限 | 保留货位失败，同时结构化报告时长失败 |

共33个针对时长的真实HTTP检查，覆盖上述策略与状态。核对 `solverStatus`、`executable`、车辆/计划 `feasibility` 与 `actualExecutablePlanCost` 一致。另以真实 T12 修复后响应增加前端状态测试：此前的确认不能让新失败结果获得合法确认、模拟执行或导出权限。

原始完整请求见 [T12请求夹具](../../tools/city-delivery-decision/examples-2f/max-route-duration-request.json)。修复前重现见 [记录](phase7b-evidence/before-summary.json)和 `before-策略.json`，修复后见 `after-策略.json`。独立算术与边界状态见 [边界证据](phase7b-evidence/boundaries.json)。全部输入均通过现有契约，未修改原T12数据；其他边界任务由验证脚本明确构造。

## 回归与业务保护

| 实际运行检查 | 结果 |
|---|---|
| `verify.py` | 四店冲突、复用、修订、迟到拒绝；九店分配、几何、装卸及冻结方案均通过 |
| `verify_v3.py --output-dir ...` | 原标准HTTP、字段拒绝、修订授权、并发及33项时长检查通过 |
| `verify_city_gis.py` | 3646条有向OSM边、100条路径、10个锚点、距离及分钟单位通过 |
| `npm run typecheck` | 通过；包含前端与浏览器测试类型 |
| `npm run frontend:test` | 12个文件、77项测试通过，含确认、SKU相关现有测试及新增失败状态检查 |
| `npm run frontend:build` | 通过；仍有既有打包体积/混合导入提示，没有为此扩展重构 |
| Playwright city-delivery，1440×900 | 4项通过：六店02→03→04→05→06、确认、装卸模拟、JSON/作业单导出；条件变更撤销确认；四店修订和九店历史切换；SKU整箱/拆零重新规划 |
| Playwright city-geo，gis-1440 | 2项通过：柏林三车→两车、同源道路与相机、确认、装卸模拟及导出；历史九店50/38km和空闲车辆 |

基线源码在仓库外加载，使用原业务输入计算；修复后使用真实 HTTP。七组合法结果按完整 `result` 比较相等，包括总计、分配、货位、装车和卸货步骤；不把耗时或接口封装元数据当成业务差异。源码保持一致的 v1/v2 直接使用原函数复核。见 [比较与冻结哈希](phase7b-evidence/regression-comparison.json)：

- 六店仍为16km、194.80元。
- 四店实际修订仍为236.00元，装卸与货位不变。
- 九店历史三车50km、592.00元；两车38km、450.40元，没有切换成其他标准接口口径。
- 柏林三车10.801km、472.50元；两车10.828km、364.45元，结果与路网同源。
- T06仍为两车31km、189.20元；没有修改候选质量或停止逻辑。
- v1/v2全部15个冻结JSON的SHA-256前后相同，未重新生成冻结案例。

## 复现与范围

按现有启动说明在8114启动后端，8111启动前端。仓库根目录执行：

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:CITY_DELIVERY_PYTHON=(Resolve-Path .venv/Scripts/python.exe).Path
& $env:CITY_DELIVERY_PYTHON -X utf8 tools/city-delivery-decision/verify.py
& $env:CITY_DELIVERY_PYTHON -X utf8 tools/city-delivery-decision/verify_v3.py --output-dir C:/path/to/new-phase7b-evidence
& $env:CITY_DELIVERY_PYTHON -X utf8 tools/city-delivery-geo/verify_city_gis.py
npm run typecheck
npm run frontend:test
npm run frontend:build
npx playwright test --config frontend/playwright.city-delivery.config.ts
npx playwright test --config frontend/playwright.city-geo.config.ts --project gis-1440
```

`--output-dir`只改变验证证据保存位置，原测试夹具仍从既有目录读取，避免覆盖历史HTTP记录。Python3.12.14、OR-Tools9.11.4210、Node24；浏览器已有Chromium。

本轮没有新增求解器、通用抽象、异常包装或回退逻辑。Owner指定 lean-mode 文件在本机缺失，未宣称已读取该文件。此验收证明本次时长修复及所列回归，不是对所有未测试约束的完备性证明。Phase7A的候选质量及有限货位搜索缺口保持原状，不在本轮扩展。

**Phase 7B验收完成。** 独立PR以PR #2功能分支为base，等待审查，不自动合并。
