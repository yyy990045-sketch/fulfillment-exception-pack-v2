# 生产就绪验证记录（2026-09-08）

## 本地代码与契约

- `npm test -- --run`：3 个测试文件、33 个测试全部通过。
- `npm run typecheck`：通过。
- `npm ci --dry-run --ignore-scripts`：通过。
- OpenAPI YAML 结构检查：OpenAPI 3.0.3、13 个路径、19 个 schema；路径与当前 `/api` 路由一致。

## 本地 API smoke

- 生产模式下只发送 `x-actor`/`x-tenant-id`：`401 auth_required`。
- 使用本地生成的 HS256 bearer JWT：`200`。
- 主证据端点返回非法 CSV 后切换备用端点，响应保留两次尝试和选中来源。
- 语法合法但业务字段/数值错误的 CSV：`422 invalid_csv`，不覆盖旧案件。
- `more/outcome` 写入结果、说明、actor 和时间，随后 GET 可读回。
- SQLite 后端使用 WAL 与 `BEGIN IMMEDIATE`，租户与案件主键唯一。
- FX-002 API 闭环：review → propose → approve → execute → close 全部返回成功；执行动作写入 `capability_receipts`，重复 execute 使用同一 `externalRequestId`，重启服务后 GET detail/receipts 仍为 `closed` + 1 条 `local-ledger` 回执。

## Docker 验证

- `docker build --pull=false -t fulfillment-exception-pack:local-20260908-closed-loop .`：成功。
- 生产环境变量：`NODE_ENV=production`、`DEMO_MODE=false`、SQLite 后端和临时测试密钥。
- 容器 `/api/health`：`{"ok":true}`。
- 容器内有效 JWT 访问 `/api/cases`：HTTP `200`。
- 测试容器使用临时名称和临时数据卷，已停止并自动清理。

交付包路径：`/Users/xieweikai/Downloads/fulfillment-exception-pack-core-review-production-ready-2026-09-08-v10.zip`。

## EGo 浏览器验证

仅访问本机 `http://localhost:3486/`，未上传项目文件或调用公网业务服务：

- 搜索不存在的案件显示“没有匹配案件”；清空搜索后可切换 FX-002。
- FX-002 两处证据均标记后显示“差异已全部核对”，处理阶段解锁。
- 在处理阶段依次点击“开始拟定处理方案”→“提交负责人确认”→“登记处理结果”→“确认处理完成并结案”；页面显示“已结案”“已核验”和“已收到本地能力台账回执”。
- “更多能力”页显示持久化的效果回写记录。
- “推演沙盘”明确显示不会改变案件状态、不会写入回执。

## 仍然不属于本地演示证明的内容

- 企业 IdP/OIDC、真实 CRM/ERP 目标系统写入、生产数据库备份/迁移/多副本运维，需要目标环境和正式契约；当前已完成的是可重启核验的本地能力台账闭环，不把它冒充为某个真实 CRM/ERP 的验收。
