# 默认用户全量验证

日期：2026-09-07

## 后端

- 本地 `TARGET_URL=http://127.0.0.1:3410 SKIP_UI=1 node /tmp/fulfillment-default-user-e2e.js`：389/389 通过。
- 公网 `TARGET_URL=http://134.175.111.217:3410 SKIP_UI=1 node /tmp/fulfillment-default-user-e2e.js`：389/389 通过。
- 覆盖 40 个案件、7 个能力模块、案件/报告/能力读取、健康检查、评估接口、有效与无效写入、审批前置闸门、重复动作、越权负责人、空材料和未知案件。

## 浏览器用户路径

- 公网 Playwright 默认用户流程：24/24 通过。
- 覆盖模块切换、沙盘推演、报告裁决、关系图节点、一级/二级/三级页面、查看依据、拟定方案、审批、执行、核验结案、移动端选择器和无横向溢出。
- 页面错误与控制台错误：0。
- 截图：`/tmp/fulfillment-browser-user-desktop.png`、`/tmp/fulfillment-browser-user-mobile.png`。

## 现有质量门

- `npm test`：24/24 通过。
- `npm run typecheck`：通过。
- `npm run eval`：30 cases，failures=[]，negativeFailures=[]。
