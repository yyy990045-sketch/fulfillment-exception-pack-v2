# Phase 3A 三维装卸作业闭环

## 三项官方能力的实质提升

### 1. 运力与路线协同

03 调度页在真实路线和车辆检查失败时显示“查看三维冲突”，自动带入失败车辆和门店，进入 04 查看目标货物、阻挡货物和后门取货方向。

### 2. 多约束三维装载

04 继续使用后端已校验的 `placements.positions[]`，不修改坐标、尺寸或朝向。车厢增加真实地板分格、侧壁立柱、尾门开闭、纸箱圆角、封箱线和货物标识；空间占用、载重和卸货站点来自当前车辆结果。

### 3. 三维装载与装卸指导

05 已改为装卸作业工作台。主画面是当前车辆车厢，右侧是当前门店货物、剩余货物、约束检查和车辆执行状态，地图退为辅助路线视图，底部保留步骤时间轴。播放仍由真实 `steps`、`remainingCargoIdsAfter`、`blockingCargoIds` 和 `movement` 驱动。

## 真实动作数据核对

现有步骤包含：`cargoId`、`stopId`、动作顺序、前后剩余货物、目标高亮货物、阻挡货物、持续时间和指令。可执行场景的装车/卸货步骤包含真实 `movement.from/to`，并由 Three.js 直接播放。阻挡步骤不生成穿过其他货物的动作。

## 证据截图

- [04 默认三维配载](SCREENSHOTS/04-3d-final.png)
- [04 尾门关闭](SCREENSHOTS/04-3d-tail-closed.png)
- [04 后门侧视](SCREENSHOTS/04-3d-side-view.png)
- [04 四店真实阻挡](SCREENSHOTS/04-3d-conflict.png)
- [04 V02 不同车厢尺寸](SCREENSHOTS/04-3d-v02.png)
- [04 卸货步骤](SCREENSHOTS/04-3d-unload-step.png)
- [05 三维执行作业台](SCREENSHOTS/05-execution-workbench.png)
- [05 播放中](SCREENSHOTS/05-execution-playing.png)

本轮页面验收使用 ego-browser，没有使用 Google Chrome/Chromium。

## 仍然明确的边界

所有结果仍是发车前规划和合成演示；不支持真实 GPS、轴荷重心、冷链、叉车/吊装、额外搬运或在途重装。驾驶室继续基于项目已有 CC0 平头牵引车资产做城配化适配，不宣称真实品牌车型。
