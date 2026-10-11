# 3D 资产授权

本目录下的车辆模型来自 **3D Assets（3dassets.dev）** 的
"Long-Haul Trucking and Truck Stop" 资产包（CC0 1.0 Universal，公共领域）。

- `tractor-cabover-sleeper.glb` —— Cab-over sleeper tractor（平头卧铺牵引车）
  - 来源：https://3dassets.dev/assets/long-haul-trucking-and-truck-stop-cabover-sleeper-b86f0719
  - 三角面约 6.8k，材质 8，含车轮滚动与车门开启动画
- `trailer-dry-van.glb` —— Dry van semitrailer（厢式半挂车）
  - 来源：https://3dassets.dev/assets/long-haul-trucking-and-truck-stop-dry-van-trailer-b8f9c5d8
  - 三角面约 5.8k，材质 5，含车轮滚动与后门开启动画

授权：CC0 1.0 Universal（https://creativecommons.org/publicdomain/zero/1.0/）
可自由使用、修改、再分发，无需署名。此处仅作来源记录。

模型约定：+Y 向上，车头朝 +Z，轮轴沿 X，单位为米，车轮接地于 y=0。
若资产加载失败，前端会自动回退到程序化组合几何车辆，不影响页面功能。
