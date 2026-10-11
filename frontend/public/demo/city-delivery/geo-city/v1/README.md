# 离线城市 GIS 数据 · Phase 6

此目录为 OpenStreetMap 派生数据库，遵循 [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。数据署名：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)。代码仍遵循仓库许可证；合成订单、车辆、仓库和配送点不代表企业实际运营。

所有道路、建筑足迹来自 Overpass API 的原始 OSM 对象，不含抓取的在线地图瓦片。`osm-snapshot.json` 保留节点 ID、几何和使用的标签；`metadata.json` 记录快照时间、SHA-256、范围、建筑高度来源和交通模型。公开分发这些数据时须保留本说明及 ODbL 署名，修改数据库时遵守其相同方式共享要求。

| 区域 | WGS84范围（西、南、东、北） | 建筑对象 | 道路对象 | 可配送机动车道路 |
|---|---|---:|---:|---:|
| 杭州城西 | 120.05,30.25,120.09,30.28 | 810 | 692 | 305 |
| 柏林 Mitte | 13.393,52.514,13.414,52.526 | 833 | 2735 | 843 |

以上为与查询范围相交的对象数量，完整几何可能越过边界；道路包含步行道路，不能把2735条全部当作可行车道路。具体数字以各区域的 `metadata.json` 为准。

柏林：30个建筑采用有效的 `height` 标签；616个按 `building:levels × 3.2m` **估计**；187个缺少可用标签，统一估计6m。保留真实多边形、内院和多部件建筑，没有生成虚构建筑足迹。OSM标签不是本项目实测结果。杭州多数为默认估计高度，因此新地理任务采用柏林。道路宽度用 `width` / `lanes` 或道路类型估计；路面纹理、配色和标线用于空间阅读，不代表实测道路设施。

快照日期：2026-10-11。来源接口 `https://overpass-api.de/api/interpreter`。两次查询按顺序执行，查询结构如下（bbox分别代入上表，Overpass顺序为南、西、北、东）：

```text
[out:json][timeout:45];
(
 way["highway"]["area"!="yes"](S,W,N,E);
 way["building"](S,W,N,E);
 relation["building"]["type"="multipolygon"](S,W,N,E);
 way["landuse"](S,W,N,E);
 way["leisure"="park"](S,W,N,E);
 way["natural"="water"](S,W,N,E);
);
out body geom;
```

## 同源规划规则

`berlin/task.json` 是可在02导入的独立标准任务 `city-geo-berlin-mitte-009`：9个合成门店、36件包装件、3辆资源车。`paths.json` 保存中心仓和门店的WGS84坐标、原始道路节点ID、局部坐标以及100组有向道路路径。配送点落在真实路网节点上，不声明为真实门店或仓库地址。

`network.json` 用原始 OSM 节点 ID 连通，避免按相同平面坐标连接高架与地面道路。采用 primary/secondary/tertiary/residential/unclassified/living_street/service 及对应连接道路；排除 `no/private` 通行，允许配送可达道路。遵守单行与环岛标签。未知速度按25km/h，已知数字 `maxspeed` 按 `min(maxspeed,25)` 作为演示平均速度。未实施转向限制、条件通行、限高限重、实时交通或实时导航。

每段长度用WGS84经纬度的Haversine距离（地球平均半径6371008.8m），Dijkstra按路段长度选路径。距离矩阵按每对路径四舍五入到0.001km，时间按同一路径 `sum(meters/(speed/3.6))/60` 四舍五入到0.01分钟。后端使用这些矩阵，地图依返回的真实车辆与停靠顺序拼接同一批路径；路径逐对的取整误差最多0.5m。费用使用现有标准任务固定启用费和每公里费用，属于合成业务成本规则。

车辆可用性、出发时间、门店时间窗改变后，可由现有服务重新求解并重新组合道路。坐标、节点集合或矩阵被修改而没有对应路网时，界面明确停止道路叠加，绝不借用旧路线。任意新城市/新坐标需要先生成对应离线路网矩阵与路径包。

## 历史方案口径

杭州 `paths.json` 仅为旧九店道路示意，复用原始地理节点及旧无向网络、修正分钟换算，可按不同停靠顺序组合。它不承担历史业务路由。历史三车50km/¥592/09:06、两车38km/¥450.4/09:10仍来自冻结案例的合成矩阵，不使用新OSM长度重算。页面折叠的“数据与口径”同时显示示意道路长度与历史计划里程。

旧 `geo-hangzhou-xixi/v1` 文件原样保留，旧 `roadTravelMinutes` 字段曾把秒写成分钟，本实现不读取该字段。新路径均采用秒÷60。旧生成脚本不是本数据包的复现入口。

## 离线复现与核验

在仓库根目录、安装已有路线服务Python依赖后运行：

```powershell
python -X utf8 tools/city-delivery-geo/build_city_gis.py
python -X utf8 tools/city-delivery-geo/verify_city_gis.py
```

无参数构建只读取已提交的快照，不访问网络；矩阵、几何和数据来源可独立复核。道路和建筑由浏览器 Three.js 本地渲染，无地图密钥、远程瓦片或在线路由依赖。
