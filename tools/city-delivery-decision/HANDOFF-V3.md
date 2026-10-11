# 城市配送标准场景与联合反馈交接

> 版本说明：本文保留早期 V3 运行记录。Phase 2G 正式接入以 `HANDOFF-2F.md`、`CONTRACT-2F.md` 和 `http://127.0.0.1:8114` 为准；前端不再把 8112 当作标准场景服务。

本轮新增一个独立入口，不改变 v1/v2 数据文件，也不改变旧 `revise-order`、`revise-fleet` 的返回结构。

## 入口

- 服务：`http://127.0.0.1:8112`
- 健康：`GET /health`
- 契约：`GET /contract`
- 标准场景：`POST /api/city-delivery/plan-scene`
- 旧兼容入口：`POST /api/city-delivery/revise-order`、`POST /api/city-delivery/revise-fleet`

标准入口的契约也会从 `GET /contract` 的 `standardScenario` 返回。示例请求与完整响应保存在 `evidence-v3/new-scenario-request.json` 和 `evidence-v3/city-independent-six-stop-003-joint-feedback.json`。

## 标准输入

请求必须包含：

```json
{
  "scenario": { "schemaVersion": "3.0.0", "scenarioId": "...", "units": { "dimensions": "m", "weight": "kg", "distance": "km", "time": "minutes", "currency": "CNY" }, "warehouse": {}, "stops": [], "orders": [], "cargo": [], "vehicles": [], "departureTime": "08:00", "routing": {}, "costs": {}, "rules": {} },
  "strategy": "route-first | joint-feedback",
  "budgetMs": 2000,
  "allowLayoutRepair": true,
  "allowReassignment": true
}
```

每件货物必须有 `cargoId`、`orderId`、`stopId`、米制长宽高和严格大于 0 的 `weightKg`。缺失重量、`weightKg=0`、单位不匹配、重复编号、订单货物归属不一致、缺矩阵、未声明规则都会以 `422 INPUT_INVALID` 拒绝。

车辆必须声明载重、车厢净长宽高、后门位置和车辆费用。门店必须声明服务时间窗。路线矩阵必须是完整的中心仓加门店 `n x n` 矩阵。

## 结果状态

- `FEASIBLE`：所有已声明硬约束通过，结果仍需前端/用户确认后才成为计划。
- `SEARCH_EXHAUSTED`：有限布局与路线边界内没有找到结果，不代表全局无解。
- `INPUT_INVALID`：输入错误或缺少必要事实，不进入计算。
- `SERVICE_ERROR`：计算异常，没有发布可执行结论。
- `TIMEOUT`：服务硬时限 8 秒内未完成。
- `BUSY`：两个隔离计算槽位均被占用，稍后重试。

结果固定带有：`scenarioId`、`planId`、`revisionId`、`constraintVersion`、`solverStatus`、`executionMode`、`timing`、`search`、`capabilityBoundary`。

## 计算边界

路线先由 OR-Tools 在载重、时间窗和车辆候选上搜索。联合反馈模式在货位检查失败后，尝试有限的两层/多列整站布局和其他路线候选。每个候选最终都会重新检查边界、重叠、载重、朝向、易碎、承托、承重、后门直线装卸和时间窗。

没有做出“全局无解”结论；没有通过的候选返回失败原因和搜索边界。当前不覆盖轴荷重心、绑扎、冷链、真实道路交通、在途重装、任意自由拖拽和全局最优。

## 对照证据

`evidence-v3/comparison.json` 使用相同订单、车辆资源、费用和约束，并交替运行 `route-first` 与 `joint-feedback`，每个场景每种策略 3 次，统一预算 2000 ms。记录可行率、实际可执行计划成本、装载冲突、修订货物数、未分配任务，以及求解、检查、布局和整体耗时。

结果摘要：四店样例两种策略均可行且成本相同；九店和独立六店样例中，路线优先的固定主布局检查失败，联合反馈找到可执行候选。该结果是三个合成实例的有限证据，不代表普遍降本或研究结论。

HTTP 复核见 `evidence-v3/http-verification.json`，包含新实例、旧四店、旧九店、输入拒绝、授权不改派以及五并发请求的实际状态。
