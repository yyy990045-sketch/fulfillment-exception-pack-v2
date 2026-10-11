# 城市配送首批数据交接

DATA READY：YES

SCENARIO ID：`city-delivery-synthetic-001`

唯一读取目录：`frontend/public/demo/city-delivery/v1/`。
运行中的前端以 `/demo/city-delivery/v1/manifest.json` 为入口。下列路径以站点根为基准；若部署在子路径，应跟随前端部署基址。

| 文件 | 访问路径 | 用途 |
|---|---|---|
| manifest.json | /demo/city-delivery/v1/manifest.json | 文件路径、能力、来源、单位与校验范围 |
| scenario.json | /demo/city-delivery/v1/scenario.json | 一仓、四店、一车、16 件货物、时间窗、费用规则 |
| plans.json | /demo/city-delivery/v1/plans.json | 两套计划、路线、预计到店时间和约束结论 |
| placements.json | /demo/city-delivery/v1/placements.json | 两套计划的所有货物位置、朝向及支撑 |
| unloading-steps.json | /demo/city-delivery/v1/unloading-steps.json | 逐站装卸动作和剩余货物状态 |
| comparison.json | /demo/city-delivery/v1/comparison.json | 同口径差异与布局变化 |

## 方案与真实因果

- `PLAN_A`：东城店→河畔店→南苑店→西桥店。路线 12 km，名义费用 222 元。空间、重量、朝向、易碎、支撑、承重及路线时间窗检查通过，但东城店位于前排，其货物被后排其他门店货物挡住。卸货停止于 `PLAN_A-U002`，仍有 16 件货物。后续到店时刻是假设能完成服务的路线推演，不能播放成实际完成。
- `PLAN_B`：河畔店→东城店→西桥店→南苑店。路线 16 km，预计费用 236 元。货物布局也相应调整，先送货物靠后门。上层先卸、底层后卸，各站完成后剩余件数依次为 12、8、4、0。在已声明约束范围内可执行。
- B 相比 A 增加 4 km、14 元、7 分钟。没有降本率或全局最优声称。A 不可执行，不能凭名义费用较低称其更优。

## 前端读取约定

1. 所有文件共享 `schemaVersion`、`scenarioId`。按 `planId`、`vehicleId`、`stopId`、`cargoId` 关联，禁止用数组序号替代身份。
2. `scenario.cargo[]` 的尺寸是原始货箱尺寸，重量为 `weightKg`。`placements.plans[].positions[]` 是摆放结果。
3. `x` 是宽度、`y` 是高度、`z` 是长度；前壁 `z=0`，后门 `z=5.8`。位置为最小角，长度单位米。
4. `positions[].width/height/length` 已是旋转后的轴向尺寸。画箱体时中心取 `(x+width/2, y+height/2, z+length/2)`。`rotation` 是原始货箱绕 y 轴的角度，不能再对轴向尺寸重复旋转。若使用原始尺寸绘制，则按 rotation 旋转并使用同一摆放中心。
5. 路线来自 `plans.plans[].routeNodeIds`、`stopOrder`、`legs`、`arrivals`。门店地图坐标来自 scenario，单位 km，为合成正交街区。
6. 方案切换同时切换路线、positions、约束结论与装卸步骤，清空旧播放进度。不同计划的装卸状态不能混用。
7. 每站操作来自 `unloadingSteps.plans[].stations[]` 和 `steps[]`；按 `stepIds` 顺序读取，`targetCargoIds` 高亮本站货物。
8. `highlight` 只高亮，`unload` 按 `movement.from/to` 沿 z 轴移动；动画结束后使用 `remainingCargoIdsAfter` 更新货物。剩余货物位置不变。
9. 遇到 `blocked` 立即停止，高亮 `highlightCargoIds` 与 `blockingCargoIds`，展示 `conflicts[].reason`。禁止继续下一站。A 后续站点 `not_reached`，没有可播放卸货动作。
10. 到 `station_complete` 后才能进入下一站；时间轴使用计划服务时刻。`durationSeconds` 是缩短的演示播放时间，不是现场遥测或实际服务耗时。
11. `loadingSteps[]` 提供已检查的装车动作，底层和前排先装。每步 `loadedCargoIdsAfter` 决定已装入货物。
12. 方案差异读取 `comparison.plans[]`、`delta`、`changes`。A 的费用与时刻必须保持“不可执行计划的名义推演”标记。
13. 当前只支持 V01 与 PLAN_A/PLAN_B，不支持任意拖拽、任意改序后的实时求解、额外搬运或多车调度。“重新复核”只能复核冻结方案，工具无在线求解接口。

## 已检查与未覆盖

已实际计算并逐步重放：边界、货物重叠、重量、朝向、易碎、100% 基础支撑、上方承重、后门净空、直线取货阻挡、抽走承托箱限制、装车通道、路线时间窗和费用。

未覆盖：轴荷与重心、绑扎和行驶稳定性、人员与设备空间、冷链隔离、真实交通和司机工时、侧门取货、任意旋转、额外搬运、多车分配、全局最优。

所有数据均为 Synthetic Mechanism Case。不含传化订单、真实药店数据、学术实例或冻结研究结果。

## 最小数据复核

从项目目录运行 `python3 tools/city-delivery/build_demo.py --verify`，只读重新检查已交付文件。生成脚本还包含边界、碰撞、超重、非法朝向、不足支撑、易碎、承重和超时的拒绝检查。

重新生成仅在明确需要更新演示数据时运行 `python3 tools/city-delivery/build_demo.py`。工具只写本专属数据目录，不修改前端页面或旧后端。
