# Phase 2F 后端交接

**CONTRACT READY：YES**  
**NEW SCENARIO READY：YES**  
**COMPARISON EVIDENCE READY：YES**

## 直接调用

当前重新加载后的服务地址：`http://127.0.0.1:8114`。

- 健康检查：`GET /health`
- 契约：`GET /contract`
- 场景导入检查：`POST /api/city-delivery/validate-scene`
- 场景规划：`POST /api/city-delivery/plan-scene`

服务只在本机内存中处理请求，不保存任务，不提供异步任务查询。原来的 8112 服务和 v1/v2 演示入口保持不变；前端接入新场景时需要把新请求指向 8114，不能把旧端口当成新入口。

## 可直接复核的样例

目录：`tools/city-delivery-decision/examples-2f/`

- `legal-request.json`：独立六店新场景，6 家门店、12 件货物、2 辆异构车辆，带完整矩阵与费用。
- `validation-success.json`：上述场景的真实导入检查返回。
- `planning-success.json`：真实联合规划返回，HTTP 200、`FEASIBLE=true`，包含车辆归属、路线、到店时间、货位、卸货步骤和费用。
- `layout-failure.json`：真实窄车场景，有限布局搜索耗尽，明确指出车辆和门店，不把失败说成全局无解。
- `time-window-failure.json`：真实晚发车场景，返回超过时间窗的门店、到店时间和迟到分钟数。
- `input-missing-weight.json`、`input-illegal-dimension.json`、`input-duplicate-cargo.json`：真实 HTTP 422 输入错误。

返回中的 `result.routes[].placements.positions[]` 就是 Three.js 可用的货位数据：`x` 为车厢宽度、`y` 为高度、`z` 从前壁指向后门；尺寸已按朝向展开。`result.routes[].unloading` 提供门店、步骤、剩余货物和阻挡货物。前端应以 `vehicleId` 同时关联路线、货位和卸货，不要只取第一辆车。

## 方法对照

三种方法使用同一场景、车辆、费用、约束和 2000ms 预算：

- A `route-first`：先求路线，再检查固定主布局。
- B `layout-repair`：沿用同一条路线，只搜索有限替代布局，不改车不改路线。
- C `joint-feedback`：布局失败后，在授权范围内换布局，再尝试换车或改路线。

真实记录：`artifacts/judge-evidence/phase-2f/COMPARISON-ABC.json`。

当前结果：四店样例 A/B/C 均可行且费用 222 CNY；九店三车样例 A/B 均未找到可执行布局，C 找到可执行方案，费用 444.8 CNY；独立六店新场景 A/B 均未找到可执行布局，C 找到可执行方案，费用 194.8 CNY。样本只有三个合成实例、每种三次，不能外推为企业收益或全局算法优越性。

## 版本与限制

- 输入契约版本：`3.0.0`；约束版本：`city-rear-door-3d-1.0`。
- `planId` 和 `revisionId` 由本次请求生成，仅用于前端保存和确认，不代表服务器持久化记录。
- `FEASIBLE` 只表示已声明且已实现的约束通过，并不表示全局最优。
- `SEARCH_EXHAUSTED` 表示当前有限路线/布局集合或预算内没有找到解，不证明所有装载方式都无解。
- 暂不支持额外搬运、轴荷/重心、绑扎、冷链、真实交通、司机工时、任意多层自由装箱、在途重装和生产级并发。
