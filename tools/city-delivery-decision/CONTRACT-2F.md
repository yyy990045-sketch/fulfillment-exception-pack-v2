# 城市配送新场景接口契约（2F）

这份契约对应当前可实际调用的本机服务：`http://127.0.0.1:8114`。
服务只保存于内存，单次请求完成检查和计算，不提供任务排队、历史查询或数据库。

## 入口

### `POST /api/city-delivery/validate-scene`

用于导入前检查。请求体为 `{ "scenario": <场景对象> }`。

成功返回 HTTP 200，`solverStatus=VALID`、`valid=true`，并返回标准化后的 `scenario`。
输入缺失、编号重复、单位不一致、尺寸/重量非法、订单关系不完整或声明了不支持的规则时返回 HTTP 422，`solverStatus=INPUT_INVALID`，同时给出 `field` 或错误路径。

### `POST /api/city-delivery/plan-scene`

用于每次请求重新计算。最小请求为：

```json
{
  "scenario": { "...": "见 examples-2f/legal-request.json" },
  "strategy": "joint-feedback",
  "budgetMs": 2000,
  "allowLayoutRepair": true,
  "allowReassignment": true
}
```

也可以提交 `routes`，表示用户已经给出的车辆和门店顺序。提交的路线会先按原样检查；只有明确授权时才允许系统尝试换布局、换车或改路线。

当前方法含义：

| 方法 | 实际行为 | 不会做什么 |
| --- | --- | --- |
| `route-first` | 先用路线求解，再检查固定主布局 | 不使用几何反馈，不换布局、不换车 |
| `layout-repair` | 沿用第一次得到的路线，只搜索有限替代布局 | 不改路线、不换车 |
| `joint-feedback` | 布局失败后先换有限布局，再在授权范围内尝试换车或改路线 | 不保证全局最优 |

## 场景输入

`scenario.schemaVersion` 必须为 `3.0.0`。单位必须明确为：尺寸 `m`、重量 `kg`、距离 `km`、时间 `minutes`、费用 `CNY`。

场景必须包含一个 `warehouse`（编号固定为 `DEPOT`）、`stops`、`orders`、`cargo`、`vehicles`、`departureTime`、`routing`、`costs`、`rules` 和来源声明 `source`。

每件货物用 `cargoId` 唯一标识，并同时带 `orderId`、`stopId`、`length`、`width`、`height`、`weightKg`、`fragile`、`maxTopLoadKg` 和 `orientation`。车辆用 `vehicleId` 唯一标识，车厢尺寸在 `compartment`，后门在 `rearDoor`。

矩阵节点顺序必须为 `["DEPOT", ...stops.stopId]`，距离和时间矩阵必须完整，主对角为 0，其余路段为正数。

## 规划返回

返回字段的关联关系如下：

- `scenarioId`：贯穿输入、计划和修订的场景编号。
- `planId`：由本次请求内容生成的计划身份；不代表持久化记录。
- `revisionId`：本次请求对应的修订身份。
- `solverStatus`：`FEASIBLE`、`SEARCH_EXHAUSTED`、`INPUT_INVALID`、`SERVICE_ERROR`、`TIMEOUT` 或 `BUSY`。
- `executable`：只有所有已声明硬约束通过时才为 `true`。
- `result.routes[]`：每辆车的路线、到店时间、成本、货物位置和逐站卸货。
- `result.routes[].placements.positions[]`：货物三维位置。坐标约定为 `x` 宽度方向、`y` 垂直方向、`z` 从前壁向后门递增；位置是货物最小角点，尺寸已经包含朝向后的长宽变化，不得再次交换。
- `result.routes[].unloading`：站点顺序、步骤、阻挡关系和最终剩余货物。
- `initialCheck`：第一次路线/布局检查结果，用于和修订后结果对照。
- `revision.changedCargoIds` 与 `revision.changes`：实际发生货位变化的货物及前后位置。
- `revision.reassigned`：是否改变了车辆归属。
- `actualExecutablePlanCost`：只有找到可执行计划时才提供；失败时为 `null`。
- `timing`：求解、约束检查、布局生成和总计算耗时。
- `search.failureEvidence`：有限搜索遇到的真实原因。`SEARCH_EXHAUSTED` 只表示当前边界内没找到解，不表示全局无解。

服务不会自动确认方案，返回中的 `confirmed` 永远为 `false`，前端确认应保存完整的 `planId`、`revisionId` 和原始结果。

## 已检查规则

当前实际检查：车厢边界、货物重叠、载重、允许朝向、易碎与上方承重、完整支撑、后门直线装卸、逐站阻挡、服务开始时间窗、每店和每件货物唯一分配。

当前不支持：额外搬运、轴荷与重心、绑扎、冷链、真实交通、司机工时、任意自由多层装箱、在途重装、全局最优证明和生产级并发服务。布局搜索是有限集合；失败需按 `SEARCH_EXHAUSTED` 展示。

## 兼容关系

原有 `POST /api/city-delivery/revise-order`、`revise-fleet` 和 `/contract` 保持不变。v1、v2 静态文件不改写；新场景使用本契约的 `3.0.0` 输入，不要求前端把 v1/v2 重命名成新场景。

## 可复核材料

- 实际请求与返回：`examples-2f/`
- 三方法同口径记录：`artifacts/judge-evidence/phase-2f/`
- 现有 v1/v2 兼容入口：`tools/city-delivery-decision/HANDOFF.md`
