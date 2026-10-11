# Review

## Critical

无。标准场景导入、真实规划、三维显示、确认和导出已在浏览器完成一条完整操作链。

## Warning

- 8114 是本轮唯一正式接入服务；8112/8113 当前没有作为前端运行依赖保留。旧接口已在 8114 实际复核，但部署时必须保持 8114 或通过 `CITY_DELIVERY_BACKEND_URL` 指向同一版本。
- 保留验证只有 10 店、20 件、3 车，不能外推生产规模；A/B/C 也只有三个主样例各三次运行。
- 后端服务无持久化和异步查询，导出文件是企业交接示例，不是生产 TMS 集成。

## Verification

- `npm run typecheck` 通过。
- `npm run frontend:build` 通过；仅有既有 Three.js 大包和动态导入提示。
- 浏览器实际完成新场景导入、后端校验、C 策略规划、路线与货位查看、确认、效果页和 JSON 下载。
- 浏览器实际打开六页和旧四店/九店入口，无页面错误。
- `verify_v3.py` 在 8114 返回 VALID、FEASIBLE、SEARCH_EXHAUSTED，并复核旧单车/多车入口。
