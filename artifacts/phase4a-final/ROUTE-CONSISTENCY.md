# 路线一致性

## 地理路径

`tools/city-delivery-geo/build_hangzhou_xixi.mjs` 将 OSM 道路节点构成图，使用 Dijkstra 最短路径生成路线几何、道路段编号、道路距离和道路行驶时间。路线几何保存于 `route-geometries.json`。

## 业务计划

三车/两车方案沿用 v2 已核验的车辆归属、停靠顺序、费用和业务里程。地理包的每条路线同时保存：

- `roadDistanceKm`：本地 OSM 道路图最短路径长度。
- `roadTravelMinutes`：道路距离乘统一 2 分钟/km 速度假设。
- `planDistanceKm`：原 v2 业务方案指标。
- `planDrivingMinutes`：原 v2 业务方案指标。

因此当前 03 是“真实道路空间 + 既有业务计划”边界清晰的独立地理演示，不声称旧业务费用已经由杭州真实路网重新求解。v1/v2 原始结果没有修改。
