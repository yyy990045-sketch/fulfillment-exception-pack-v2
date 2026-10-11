# 城市配送最小可干预决策交接

## 当前交付

- v1 的六份文件、原生成工具及已有页面均未修改。
- 单车：提交四家门店的任意完整访问顺序，实际重算时间窗、路线费用和原货位卸货阻挡。允许修订时，搜索四个既有门店货物分区的重新排序；优先少移动货箱，再减少移动距离。修订后的布局再次检查空间、朝向、支撑、易碎、承重、装车通道、卸货和时间窗。
- 多车：独立场景 `city-delivery-multivehicle-synthetic-001`，一仓、九店、36 件、三辆异构车。每个门店及每件货物唯一分配；每车都有独立检查、货位和装卸步骤。闲置车显式标记 `active=false/status=idle`，路线和货物为空，不计车辆启用费用。
- 多车调整：可提交完整车辆分配与每车门店顺序。默认只检查，不擅自变更分配。只有 `allowReassignment=true` 且提交方案不可执行时，才尝试重新分配车辆和路线。
- 两套多车方案都可执行，使用同一资源池、订单和费用规则。基础方案 3 辆/50 km/592 元/最晚 09:06 完成回仓；候选方案 2 辆/38 km/450.4 元/最晚 09:10 完成回仓。费用少 141.6 元，但最晚完成时间增加 4 分钟，不能只宣称全面更优。数字是当前合成场景的结果。

## 前端可用数据

独立目录 `frontend/public/demo/city-delivery/v2/`，入口 `/demo/city-delivery/v2/manifest.json`。

| 文件 | 内容 |
|---|---|
| scenario.json | 九店、36 件、三辆异构车、独立车厢和费用、矩阵与约束 |
| plans.json | 两套方案，`plans[].routes[]` 为每车完整计划，`assignments[]` 为门店与货物分配 |
| placements.json | `plans[].vehicles[].positions[]` 为每辆车的实际货位 |
| unloading-steps.json | `plans[].vehicles[].stations[]/steps[]/loadingSteps[]` 为逐站装卸 |
| comparison.json | 两套可执行方案的同口径指标、每车到店时刻与变化值 |
| decision-contract.json | 请求和返回结构、能力与限制 |
| order-adjustment-examples.json | 实际计算的原布局可用、原布局受阻后修订、禁止修订、修好布局但迟到四种结果 |
| fleet-adjustment-example.json | 宽箱错误分配给小车后，报告实际宽度问题并重新分配的完整结果 |

v2 是独立多车结构，不覆盖 v1，也不会被当前 v1 页面自动读取。选车后，以 vehicleId 对应的 route、positions 和 unloading 一起显示，不能继续只读取 `vehicles[0]`。坐标和旋转约定与 v1 相同；摆放尺寸已经包含朝向变化。

## 可提交用户调整的入口

本机服务 `http://127.0.0.1:8112`，`GET /health` 查看可用性，`GET /contract` 查看交接结构。

### 单车门店顺序调整

`POST /api/city-delivery/revise-order`，Content-Type 为 application/json。

```json
{
  "scenarioId": "city-delivery-synthetic-001",
  "basePlanId": "PLAN_B",
  "stopOrder": ["S01", "S02", "S04", "S03"],
  "allowLayoutRepair": true
}
```

可选 `departureTime` 使用 HH:MM，可演示晚发车造成时间窗不满足。原顺序和原货位均从 v1 读取，请求不会修改原文件。门店必须全部且只出现一次。

重要返回字段：

- `executionMode=computed-per-request/precomputedOnly=false`：每次请求实际计算，不是从两个固定方案中挑一个。
- `originalLayoutCheck.unloadingCheck.firstFailure`：原布局中的目标货物、阻挡货物及原因。
- `originalLayoutReusable`：原货位的空间、装车与卸货能否继续使用；时间窗仍要独立查看。
- `revision.status=reused/revised/not_repaired`：是否原样保留、实际修订或未找到修订。
- `revision.changes`：每件被移动货物的原位置与新位置。
- `result.stopOrder/routeNodeIds/arrivals/costs`：提交顺序对应的新路线、时刻与费用。
- `result.placements.positions`：最终实际三维位置。
- `result.unloading.stations/steps/loadingSteps`：最终装卸序列。
- `executable`：所有已声明硬约束的最终结论。即使布局修订成功，时间窗失败仍为 false。
- `result.feasibility.reasons`：迟到、碰撞、卸货阻挡等原因。

前端必须整体切换结果，而非只替换门店文字。只有 `executable=true` 才能呈现可执行计划。`blocked` 步骤必须停下。

### 多车分配及顺序调整

`POST /api/city-delivery/revise-fleet`：

```json
{
  "scenarioId": "city-delivery-multivehicle-synthetic-001",
  "routes": [
    {"vehicleId": "V01", "stopOrder": ["S03", "S01", "S09"]},
    {"vehicleId": "V02", "stopOrder": ["S05", "S04", "S06"]},
    {"vehicleId": "V03", "stopOrder": ["S02", "S07", "S08"]}
  ],
  "allowReassignment": true
}
```

本例把宽箱门店 S09 放进小车。小车载重和总体积尚有余量，但实际两列箱体不能满足车厢宽度，因此原提交计划不可执行。结果会保留 `submittedCheck` 的原因，再在授权范围内尝试换车/重新分配。若 `allowReassignment=false`，只返回失败，不偷偷改顺序或车辆。

重要返回：`submittedCheck`、`result.routes[]`、`result.assignments[]`、`result.totals`、`revision.reallocated` 和 `executable`。每辆车的 `placements` 和 `unloading` 均位于对应 route 内。货位无法生成时返回 null，并标注没有完成空间/卸货检查，不伪造可行位置。

## 运行与边界

启动：

```sh
tools/city-delivery-decision/.venv/bin/python tools/city-delivery-decision/server.py
```

依赖仅隔离安装在本工具目录中，没有改项目依赖、旧后端或前端。若环境不存在，建立本目录 `.venv` 后安装 `requirements.txt`。生成新目录的数据使用 `build.py`；只读核对使用 `verify.py`。不运行旧研究或 Benchmark。

所有调整均限发车前规划。货位修订表示重新准备装车方案；不支持已发车车辆自动重装。费用只含已有车辆、行驶、等待及额外搬运规则，不包含未提供的重装工时费。

多车路线使用 OR-Tools；装载采用明确的两列、两层、整站分区方法。实际生成坐标后再逐箱检查，不使用吨位或总体积冒充空间证明。分区方法失败只表示当前方法未找到布局，不证明所有装箱方式均无解。路线搜索有两秒上限，不宣称全局最优。

不支持任意货物尺寸输入、任意拖拽、额外搬运、轴荷与重心、冷链、真实交通、司机工时或生产级服务。

当前页面尚未增加“提交顺序”或“多车分配”的操作按钮，本轮遵守文件隔离只交付计算与数据。前端下一轮连接这些入口即可，不能把本轮交付称作页面交互已经完成。
