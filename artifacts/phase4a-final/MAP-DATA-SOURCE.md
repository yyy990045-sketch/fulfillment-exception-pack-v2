# 地图数据来源

- 区域：杭州城西固定范围，WGS84 bbox `30.255,120.055,30.265,120.075`。
- 来源：OpenStreetMap contributors，通过 Overpass API 获取。
- 获取日期：2026-10-11。
- 道路快照：56 条 highway 要素，包含 primary/secondary/tertiary/residential/service 等道路属性。
- 建筑快照：32 个 building Polygon 要素。
- 高度策略：优先 OSM `height`，其次 `building:levels × 3.2m`，否则使用明确标记的估计 6m。
- 许可证：Open Database License 1.0；项目内保留来源与 attribution。

页面显示“OSM 派生离线快照 · 非实时导航”，不依赖在线地图密钥。
