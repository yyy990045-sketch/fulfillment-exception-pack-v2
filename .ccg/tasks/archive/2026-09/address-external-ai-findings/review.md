# 外部审查建议处理记录

## 已落地

- 租户作用域统一：初始化 runtime、evidence pack 和 evidence 使用请求租户；案件详情不再返回 GoldCase 原始 materials 或 expected* 评估字段。
- 写操作要求操作者；支持受限 ASCII actor alias，未知或缺失 actor fail-closed。
- 禁止 approved/executed/closed 案件重复 propose；approve、execute、close 对动作状态和回执做不变量检查。
- review、adjudication、propose、approve、execute、close 统一进入同进程案件 mutation queue。
- tenant 文件名改为 SHA-256 派生键，并保留旧文件读取兼容。
- evidence ID、structuredFields key 纳入 sourceVersion；orderId 保留为显式冲突字段；gap 检测限定 complaint source。
- mock receipt 在报告和 UI 中保留；报告引用保留精确 locator。
- 前端 render 使用 generation/request identity 防止旧案件或旧模块响应覆盖当前页面；动作请求捕获目标案件。
- GET 读取改为无持久化初始化；未知 capability 返回 404。
- 事件时间戳改为运行时 ISO 时间；重复 review 不新增事件。

## 尚未完成 / 需要真实环境或架构改造

- `x-actor` 仍是演示身份输入，不等于真实认证；生产环境必须从认证会话/服务端主体取得 actor，并做租户授权。
- JSON 全文件 read-modify-write 仍缺跨进程锁或数据库事务；当前 queue 只覆盖单进程。
- GoldCase `expectedActionTypes` 仍被 runtime 使用；需要把业务策略与评估期望完全拆开后再改。
- review 仍记录 reviewed IDs，未扩展为证据选择、理由和 resolved value。
- 多来源 pair 冲突尚未归并为独立业务问题；CSV 解析器、OpenAPI 契约、Promise.allSettled 降级和 capability 真正写入语义仍待后续。

## 验证

- `npm test`: 27/27 passed
- `npm run typecheck`: passed
- `npx tsx src/eval/cli.ts`: 30 cases; failures=0; negativeFailures=0
- 本地 `127.0.0.1` API smoke：跨租户 detail 均为请求租户且 materials=0、expected* 字段不外泄；缺 actor=401；未知 capability=404；re-propose=409；无回执 close=409；GET detail/report 不产生新租户文件。
