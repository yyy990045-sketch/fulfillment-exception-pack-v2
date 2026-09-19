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

## Resolved In Commercial Pilot Hardening

- Confirmation Sheets stay open on approve, execute, or close failure, show a business error in place, and allow retry; success still closes the Sheet.
- Workbench exceptions now include a backend-owned `governanceStage`, including the distinction between `proposal_draft` and `pending_approval`.
- Exception Queue display, filtering, sorting, and Record Header current-stage labels consume the backend governance projection.
- Installed Solution Packs now expose backend-derived `boundContexts`; the React page no longer infers Pack binding from `contextType`.
- Demo Account Area can switch between backend-projected demo organizations, invalidates tenant-scoped query caches, and follows backend-provided safe routes.
- Technical metadata now uses a shared Audit Details Sheet; Evidence Preview keeps business source, original text, field, value, time, and locator at the primary layer.
- Operational trend buckets now return `label`, `from`, and `to`; drill-down no longer parses bucket display keys.
- Solution Pack projections now expose backend-owned `supportedActions` with business labels sourced from the action catalog.

## Resolved In Manufacturing Information Architecture Rebuild

- Context Page now contains only the context Header, Digital Thread, and exception queue.
- Exception Record Page is a true route with its own Header and compact related-context strip.
- Overview, Evidence, Analysis, Decision, and Governance now render as separate task routes.
- Decision no longer renders Governance below the recommendation and links to `/governance` instead.
- Governance keeps only the current step expanded and shows current phase, owner, and current plan above the process.
- Queue filters are retained in the URL and queue scroll position is restored when returning from a record.
- Duplicate navigation in the exception Header More menu was removed.

## Resolved In Visual Design Rebuild

- Added a unified neutral enterprise token set for background, surfaces, borders, text, semantic states, radius, and floating shadow.
- Added separate Shell, list, Record, and long-form reading widths so content no longer stretches across the full viewport.
- Rebuilt the Digital Thread as a connected process flow with typed hierarchy and prominent business values.
- Rebuilt the Exception Record Header as one surface with a fact strip and related context chain.
- Added a sticky Record navigation with restrained active states.
- Rebuilt Overview as a two-column understanding workspace.
- Rebuilt Evidence as a list plus preview workspace, keeping technical metadata in the Sheet.
- Made the recommended Decision option the primary surface and alternatives secondary.
- Added a compact Governance stepper with only the current step expanded.
- Refined Operations summary/table density and Solution Pack's three-level workspace.
- Added centralized Chinese presentation names for built-in Solution Packs.
- Raised the Chinese body baseline to 14px and reduced legacy 10/11px metadata usage in primary surfaces.
- Reduced Context, Governance, Overview, and Evidence border/card stacking through dividers and background contrast.
- Converted Solution Pack capabilities from badges to lightweight checks and removed raw business keys from the primary Thread.

## P0

0

## P1

### Page query fragmentation

- 位置：Manufacturing 工作台首屏
- 问题：Workbench、Evidence、Capability、Policy、Resolution、Outcome 分别请求和展示 loading/error。
- 影响：局部区域可能先后闪烁，用户难以判断页面是否已完全可用。
- 建议：增加页面级 projection 或统一 query state，但不建议本 Sprint 扩展 Backend。

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

### Exception Record uses full Workbench projection

- 位置：Exception Record 的 Overview / Evidence / Analysis / Decision / Governance 路由
- 问题：每个子 Route 仍通过 Workbench API 读取整个 Context 的 thread、rules 和 exceptions，再在前端取出当前异常。
- 影响：当前数据规模下可用，但异常记录增长后会带来不必要的响应体和服务端计算。
- 建议：后续增加只读的 Exception Record projection，按 exception 返回相关上下文、规则和异常摘要；本轮不扩展 Backend contract。

### Formal product brand not defined

- 位置：App Shell 产品品牌
- 问题：当前仓库没有可确认的正式产品名称，只能使用中性名称 `履约异常治理平台`。
- 影响：客户演示可用，但长期品牌识别和产品命名仍需正式决定。
- 建议：产品命名确定后，只替换共享产品名称常量，不在页面中散落硬编码。
