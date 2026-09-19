# Pilot Deployment Checklist

本清单用于企业受控试点，不假设已有 Kubernetes、SSO、ERP 或客户生产系统接入。

## Environment

- [ ] 明确 Pilot 主机、端口、运行用户和网络边界。
- [ ] 明确数据存储目录、磁盘容量和文件权限。
- [ ] 确认是否允许外部网络访问；默认按最小网络策略运行。
- [ ] 记录当前代码 SHA、构建产物 hash 和数据库版本。
- [ ] 确认回滚目录和上一个可用版本。

## Authentication

- [ ] 明确 Demo header 或 Bearer JWT 模式。
- [ ] 如果使用 Bearer，确认真实 `subjectId`、`roles`、`scopes` 和 tenant claim。
- [ ] 确认 `AUTH_SECRET` 由受保护环境变量提供，不进入仓库或日志。
- [ ] 确认 viewer 不能执行 approve、execute、close。

## Tenant

- [ ] 明确 Pilot tenant ID 和业务组织名称。
- [ ] 确认租户间 Context、Evidence、Resolution 和 Pack binding 隔离。
- [ ] 确认 `organizationSource` 是 demo、claim 还是 tenant fallback。
- [ ] 如果多租户同时试点，确认 single-tenant migration ambiguity 的诊断和隔离流程。

## Data Sources

- [ ] 列出本次允许导入的来源系统、文件类型和负责人。
- [ ] 明确 synthetic、脱敏和生产数据的使用边界。
- [ ] 确认原始文件是否允许留存，以及留存期限。
- [ ] 确认来源系统名称、文档版本和 Evidence 原始定位。

## Field Mapping

- [ ] 确认业务实体、字段、值类型和规则所需 metric key。
- [ ] 确认日期、金额、数量、状态和空值语义。
- [ ] 对每个映射提供样例输入和预期 Evidence。
- [ ] 映射变更必须有版本和变更记录。

## Rule Confirmation

- [ ] 确认规则启用列表和例外场景。
- [ ] 确认规则是 deterministic，不使用 AI 直接判定 Exception。
- [ ] 对 matched、not_matched、insufficient_evidence 和 ambiguous_evidence 做样例验收。
- [ ] 记录规则版本和内容 hash。

## Roles

- [ ] 列出 Pilot 用户、subjectId、角色和负责阶段。
- [ ] 确认 owner role 来自后端 assignableOwnerRoles。
- [ ] 确认正式 RBAC 管理后台不在本次范围。
- [ ] 明确角色变更和离职处理流程。

## Approval

- [ ] 确认审批角色、审批范围和高影响动作。
- [ ] 验证方案提出人与审批人职责分离。
- [ ] 验证无权限、错误状态和 SoD 会 fail closed。
- [ ] 验证 approval Sheet 失败时保持打开且可重试。

## Evidence

- [ ] 确认 Evidence 的 source、quote、locator、observedAt 和 support。
- [ ] 确认缺失 Evidence 时不会生成事实性结论。
- [ ] 确认 AI 输出只能引用已有 Evidence。
- [ ] 确认人工能够查看技术和审计详情。

## AI Provider

- [ ] 明确本次使用 deterministic provider、OpenAI 还是 Jev。
- [ ] 如果使用 OpenAI / Jev，确认 API key、模型、超时和出网策略。
- [ ] 确认未配置 provider 时返回 not_configured，不静默伪造 live 结果。
- [ ] 确认 AI 输出不能修改 Policy、Resolution、Automation 或 Execution。

## Connector

- [ ] 明确本次是否使用 reference/local connector。
- [ ] 如果接真实系统，完成认证、字段映射、幂等、重试和回执验证。
- [ ] 确认 secret 只保存在 secretRef / 安全环境，不写入仓库和日志。
- [ ] 确认外部系统接入前仍保持人工审批边界。

## Logs

- [ ] 明确应用日志、审计日志和错误日志的保存位置。
- [ ] 禁止记录密码、API key、tenant UUID、连接串和完整敏感 payload。
- [ ] 验证高影响动作有可追踪的 actor、time、object 和 result。
- [ ] 明确日志查询和试点结束时导出方式。

## Backup

- [ ] 确认 SQLite 数据文件、WAL 和配置的备份位置。
- [ ] 安排一次备份恢复演练。
- [ ] 记录备份频率、保留期和责任人。
- [ ] 确认备份不包含未授权 secret。

## Rollback

- [ ] 明确代码回滚命令和上一个可用 SHA。
- [ ] 明确数据库 migration 是否可向前兼容。
- [ ] 验证回滚后旧版本仍可读取当前数据。
- [ ] 确认试点期间禁止无审查的 destructive migration。

## Data Retention

- [ ] 明确原始 Evidence、AI 输出、审计日志和 Outcome 的保留期限。
- [ ] 明确删除、归档和脱敏流程。
- [ ] 确认客户数据不会进入公开仓库、公开演示或第三方工具。
- [ ] 试点结束前确认数据归还或销毁方式。

## Acceptance

- [ ] 完成 15–20 分钟客户 Demo Runbook。
- [ ] 完成 frontend、E2E、backend、typecheck、eval 和 OpenAPI 回归。
- [ ] 记录已通过能力、未通过能力和明确 blocker。
- [ ] 客户验收只覆盖本次 Pilot Scope，不自动扩展为生产承诺。
- [ ] 输出最终验收报告和剩余 Production Gaps。
