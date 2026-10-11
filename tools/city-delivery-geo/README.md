# Phase 6 · 真实3D城市调度

复用 Three.js 和原Python规划器；不更换求解器，不修改Phase5C业务契约与冻结案例。MapLibre建筑挤出也可实现城市效果，但本项目已具备离线几何与Three.js交互，换引擎会增加样式/瓦片准备和运行依赖，因此保留现有引擎。

数据许可、覆盖、OSM查询、高度估计、路径与矩阵规则见 [数据说明](../../frontend/public/demo/city-delivery/geo-city/v1/README.md)。

## 新电脑启动

需要 Node.js 24、Python 3.12。以下在Windows PowerShell、仓库根目录运行，不需要地图服务密钥。

```powershell
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tools/city-delivery-decision/requirements.txt
.\.venv\Scripts\python.exe -X utf8 tools/city-delivery-decision/server.py --port 8114
```

另开终端启动前端：

```powershell
$env:VITE_LOGISTICS_DIRECT='true'
npm run frontend:dev -- --host 127.0.0.1 --port 8111 --strictPort
```

打开 `http://127.0.0.1:8111/frontend/city-delivery/dispatch`。点击“加载地理任务并规划”调用真实检查与规划。也可下载旁边的“任务 JSON”，在02用原“导入配送任务”上传、检查、规划。地图及数据离线运行；首次安装npm/Python依赖需要网络。Linux/macOS使用相应venv路径和 `VITE_LOGISTICS_DIRECT=true npm run frontend:dev ...`。

## 演示步骤

1. 02导入 `frontend/public/demo/city-delivery/geo-city/v1/berlin/task.json`，通过检查后提交联合规划。
2. 03查看真实道路上的三车分配、路线、门店、到店时间与件数。选车辆不会复位视角；点击地图门店定位且同步右侧停靠顺序。左键旋转、右键平移、滚轮缩放；工具栏可复位或进入近景。
3. 确认方案；改变条件，停用V01，重新规划。地图跟随两车新分配与顺序重组道路，当前费用与返仓时间随新结果变化。
4. 04查看同一计划的实际货位和装车步骤；05开始模拟执行，全部有效车辆按返回的卸货步骤完成，导出JSON与可打印HTML作业单；06查看当前结果。
5. 返回九店历史场景，切换三车/两车查看道路示意差异与空闲V01。其50/38km及历史费用不能与新柏林路网口径互换。

当前样本真实规划输出：三车10.801km、¥472.5、最晚08:35；停用V01后两车10.828km、¥364.45、最晚08:44。每次须按当前返回结果展示；不声称全局最优或企业实际降本。

## 原实现问题的处理

| 核查点 | 处理结果 |
|---|---|
| 原32栋/56条密度不足 | 保留历史数据，展示扩展杭州810栋/692条；新增柏林833栋/2735条离线城市 |
| 建筑南北镜像 | Shape北向与旋转后的世界坐标统一；保留多边形内院 |
| WebGL细线街道 | 实际道路中心线生成有宽度路面、路肩、交叉口与阅读标线 |
| 切车重建与复位 | 静态城市仅随数据区域改变；车辆/方案更新叠加层 |
| 标准任务合成地图 | 独立地理ID绑定真实坐标/矩阵/道路，新任务03使用GIS；原六店保持诚实空间示意 |
| 历史里程与路网不同 | 历史计划与示意路网显式区分，新任务采用同源路网矩阵 |
| 秒/分钟混用 | 新生成路径用秒÷60；旧字段原样冻结、停用 |
| 默认高度误当实测 | 分别记录height标签、楼层估计与默认估计，地图披露假设 |
| 方案变化丢失几何 | 用当前返回的车辆及停靠顺序组合所有节点对路径，无首个历史方案回退 |

## 复核

```powershell
.\.venv\Scripts\python.exe -X utf8 tools/city-delivery-geo/verify_city_gis.py
.\.venv\Scripts\python.exe -X utf8 tools/city-delivery-decision/verify.py
npm run typecheck
npm run frontend:test
npm run frontend:build
npx playwright install chromium
$env:CITY_DELIVERY_PYTHON=(Resolve-Path .\.venv\Scripts\python.exe).Path
npx playwright test --config frontend/playwright.city-geo.config.ts
npx playwright test --config frontend/playwright.city-delivery.config.ts
```

GIS浏览器验收覆盖1440×900和1920×1080，每个视口独立保存城市全景、倾斜近景、多车辆、选车、方案变化和新地理任务截图，同时核对真实HTTP结果、相机/画布保持、02→06与导出。截图是产品运行记录，构建通过或画布存在不能替代视觉验收。
