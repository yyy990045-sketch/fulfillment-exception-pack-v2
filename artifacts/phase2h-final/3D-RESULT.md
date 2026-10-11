# Phase 2H-3D 三维专项结果

## 模型与车厢

继续复用项目已有 CC0 车辆资产，并把它作为城市配送厢式车的驾驶室与底盘参考。真实车厢净尺寸仍由当前车辆场景决定，货物仍由后端 `placements.positions[]` 决定。

车厢内部新增了地板防滑分格、侧壁立柱、金属框架、尾门关闭面板和开门状态。车厢外壳保留透明剖视，完整外观时不再让内部货物遮挡车体观察。

资产来源：[LICENSE.md](../../frontend/public/assets/models/LICENSE.md)。本轮没有引入新的未授权模型。

## 货箱表现

货物从普通 BoxGeometry 改为带倒角的圆角箱体，保留真实长宽高和朝向。每件货物增加封箱线、边角、编号牌、门店颜色、选中高亮、阻挡高亮和修订边框。视觉增强不改变坐标、尺寸或货物数量。

## 镜头和视图

保留自由旋转、缩放、聚焦、俯视和侧视；增加尾门开闭切换。默认机位仍由当前车厢长度自动决定，V01/V02/V03 会使用各自真实车厢尺寸，不共用一套比例。

## 装卸

卸货仍由后端 `unloading.steps` 和 `movement` 驱动。移动过程增加缓入缓出，货物完成移动后才从剩余状态中消失。阻挡状态继续显示目标货物、阻挡货物和后门通道，未新增吊装、叉车或额外搬运假动作。

## 真实截图

- 默认配载：[04-3d-final.png](SCREENSHOTS/04-3d-final.png)
- 尾门关闭：[04-3d-tail-closed.png](SCREENSHOTS/04-3d-tail-closed.png)
- 侧视：[04-3d-side-view.png](SCREENSHOTS/04-3d-side-view.png)
- 四店真实冲突：[04-3d-conflict.png](SCREENSHOTS/04-3d-conflict.png)
- 不同车厢尺寸 V02：[04-3d-v02.png](SCREENSHOTS/04-3d-v02.png)

这些画面均来自 ego-browser 的实际运行页面。
