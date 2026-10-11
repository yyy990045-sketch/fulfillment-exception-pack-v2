# Phase 4A 验收

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 真实 OSM 道路加载 | 通过 | `phase4a-final-dispatch.png`、`roads.geojson` |
| 真实建筑轮廓加载 | 通过 | `buildings.geojson`、Three.js 挤出图层 |
| 三车方案全局图 | 通过 | `phase4a-final-dispatch.png` |
| 两车候选方案真实更新 | 通过 | `phase4a-final-dispatch-plan-b.png`，V01 空闲、V02/V03 任务更新 |
| 车辆聚焦和右侧任务更新 | 通过 | 页面车辆列表和右侧 V01/V02 状态 |
| 道路路线几何 | 通过 | `route-geometries.json`，OSM roadSegmentIds |
| 04/05 兼容 | 保持 | 未修改 v1/v2、placements、unloading steps |
| 在线地图密钥 | 未使用 | 本地 OSM 离线快照 |

## 当前限制

- 这是独立杭州地理演示场景；旧业务费用和里程仍是合成计划指标。
- 当前建筑高度有一部分使用估计默认值，页面数据保留 `heightSource`。
- 当前未把杭州地理场景重新提交到 8114 进行全新的装载/路线联合求解。
- 仍不包含实时交通、在线导航、车辆 GPS 或生产级地图服务。
