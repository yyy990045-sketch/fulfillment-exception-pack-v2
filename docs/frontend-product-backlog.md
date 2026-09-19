# Frontend Product Backlog

记录本 Sprint 中发现、但不阻塞当前页面交付的问题，统一留待集中评审和修复。

## Resolved In Full Product UI Consistency Sprint

- Manufacturing / Operations / Solution Pack / Generic Workspace now share page width, Header, Section, Summary Strip, Local State, and severity/status Badge components.
- Generic Workspace and Solution Pack no longer expose raw severity or outcome enums in the primary UI.
- Solution Pack capability badges now show only business capabilities; `demo` is excluded from the main visual layer.
- Operations portfolio now has a sticky first column/header, lower-weight summary metrics, visible active filters, clear-all behavior, and unified insight drill-down styling.
- Generic Workspace separates rules, exceptions, governance, and outcomes instead of mixing them into one indistinguishable list.
- Existing light B2B loading, error, no-result, and empty states now use one reusable component.

## Resolved In Commercial Delivery Polish

- Header and governance workspace now share one page-level mutation controller, so pending, error, success, and capability refresh state stay synchronized.
- Approve, execute, and close now require a compact confirmation Sheet with object, exception, action, actor, and risk context.
- Enter governance, review, proposal, submit, approve, execute, and close now emit non-blocking success feedback.
- Manufacturing governance copy no longer exposes Resolution, SoD, Policy, runtime, backend, or provider terms in the primary workflow.
- Product Shell now uses the neutral product name `履约异常治理平台`; the demo environment is identified as `演示环境 · 示例组织`.
- Demo resolution action copy now uses business Chinese instead of seeded English synthetic text.

## P0

当前无阻塞 Manufacturing 主工作区使用的 P0 问题。

## P1

### Resolution summary contract gap

- 位置：Manufacturing Exception Rail 的处理阶段筛选与排序
- 问题：Workbench 的 Resolution Case summary 只有外层 status，没有 action status，前端无法区分 `proposed + draft` 与 `proposed + pending_approval`。
- 影响：队列只能显示“待审批”，不能精确呈现“未提交审批”和“等待审批”。
- 建议：后续在 Workbench resolution summary 中增加明确的治理子阶段或 action 状态摘要。

### Page query fragmentation

- 位置：Manufacturing 工作台首屏
- 问题：Workbench、Evidence、Capability、Policy、Resolution、Outcome 分别请求和展示 loading/error。
- 影响：局部区域可能先后闪烁，用户难以判断页面是否已完全可用。
- 建议：增加页面级 projection 或统一 query state，但不建议本 Sprint 扩展 Backend。

### Technical metadata duplication

- 位置：Evidence Inspector、Exception Details Sheet、Analysis 面板
- 问题：Evidence ID、source ID、hash、provider 等技术字段仍在多个次级入口重复出现。
- 影响：审计入口不统一，用户不确定应该从哪里查看完整技术上下文。
- 建议：定义唯一 Technical Details 入口，Evidence Inspector 只保留原文、定位和来源。

### Solution Pack context binding contract

- 位置：React 方案包页面的 Pack → Context 列表
- 问题：当前通过 Operational Analytics 的 `contextType` 反推 Pack 绑定关系，没有专门的 pack-context projection。
- 影响：两个 Pack 使用同一 `contextType` 时会互相串入，也无法可靠展示每个 Pack 的实际绑定数量。
- 建议：后端提供只读的 Pack installation → bound contexts projection；在此之前保留当前确定性映射并明确其限制。

### Pack governance action metadata

- 位置：方案包工作区的“规则能力”和方案能力区
- 问题：Manifest 只提供 capability 布尔值，没有 Pack 支持的治理动作清单或业务标签。
- 影响：页面能证明平台按 Pack 装载能力，但不能直接展示“该 Pack 支持哪些处置动作”。
- 建议：后续在只读 manifest projection 中增加 action catalog，不在前端推断。

### Time bucket drill-down parsing

- 位置：Operations 异常趋势的时间桶点击筛选
- 问题：当前用 `new Date(bucketKey)` 解释趋势桶，日/月桶通常可用，但非标准周键可能无法稳定解析。
- 影响：使用周粒度时，点击趋势桶可能不应用预期时间范围。
- 建议：后端为每个趋势桶返回明确的 `from` / `to`，前端不解析展示标签。

### Demo tenant cannot switch between installed Pack tenants

- 位置：React Demo Account Area 与 Finance Generic Workspace
- 问题：Demo frontend 固定请求 `demo-manufacturing` tenant，Finance Pack 实例位于 `demo-finance` tenant；E2E 只能通过路由层改写 tenant header 进入 Finance Workspace。
- 影响：演示用户无法仅通过界面切换不同 Pack 的租户上下文，跨领域产品价值仍需更专业的身份/上下文切换入口。
- 建议：后续由后端提供明确的 demo organization/context projection，前端只消费，不在 UI 中硬编码 tenant 映射。

## P2

### Queue filters are single-select

- 位置：Exception Rail 筛选器
- 问题：severity、status、business stage、governance stage 目前都只能单选。
- 影响：复杂队列组合筛选需要反复切换条件。
- 建议：后续引入多选标签和可保存的筛选视图。

### Scroll restoration is window-level

- 位置：Manufacturing Workbench 路由切换
- 问题：滚动恢复基于窗口位置和 tab key，没有分别记录 Rail 与主内容区域。
- 影响：在超长 Evidence 或 Analysis 页面切回时，恢复位置可能与用户预期略有偏差。
- 建议：为 Rail 和主工作面分别维护滚动容器和恢复策略。

### Legacy static surface retention

- 位置：`workbench/operations`、`workbench/workspace` 与 `manufacturing-legacy`
- 问题：本轮已将 Operations / Workspace 主路由切到 React，但旧静态文件仍保留在仓库中，`manufacturing-legacy` 也继续可访问。
- 影响：产品主路径已统一，但后续维护仍存在少量重复实现和废弃页面资产。
- 建议：在确认历史回归、文档链接和演示流程都不再依赖旧页面后，单独清理静态文件；本轮不删除。

### Frontend bundle chunk warning

- 位置：React 前端生产构建
- 问题：Vite 报告单个 chunk 超过 500 kB。
- 影响：当前功能可用，但随着 Operations、Solution Pack 和 Manufacturing 继续扩展，首屏加载会逐渐变慢。
- 建议：后续按路由 lazy-load，并把高频基础依赖拆成稳定 vendor chunk；本轮不改变产品行为。

### Remaining Manufacturing section migration

- 位置：Manufacturing 的若干次级分析、证据和治理面板
- 问题：这些区域已经复用共享 Badge 与 Local State，但仍保留各自手写的 section/header 容器。
- 影响：主流程已一致，但深度工作面仍有少量样式迁移空间。
- 建议：后续只迁移仍有真实重复的面板，不为统一而重写全部 Manufacturing 组件。

### Formal product brand not defined

- 位置：App Shell 产品品牌
- 问题：当前仓库没有可确认的正式产品名称，只能使用中性名称 `履约异常治理平台`。
- 影响：客户演示可用，但长期品牌识别和产品命名仍需正式决定。
- 建议：产品命名确定后，只替换共享产品名称常量，不在页面中散落硬编码。
