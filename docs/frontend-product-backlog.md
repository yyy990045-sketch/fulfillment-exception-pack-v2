# Frontend Product Backlog

记录本 Sprint 中发现、但不阻塞当前页面交付的问题，统一留待集中评审和修复。

## P0

当前无阻塞 Manufacturing 主工作区使用的 P0 问题。

## P1

### Cross-component mutation coordination

- 位置：`SelectedExceptionHeader` 与 `GovernanceProcess`
- 问题：同一 Resolution mutation 可能同时存在于 Header 主动作和治理工作区按钮中，两边拥有独立的 in-flight guard。
- 影响：快速切换或连续点击可能触发重复请求；后端虽然会最终校验，但前端可能显示相互冲突的 pending/error 状态。
- 建议：集中成一个页面级 mutation controller，或让 Header 主动作只导航、不直接执行治理 mutation。

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

### High-impact quick actions

- 位置：Selected Exception Header 的 submit / approve / execute / close 主动作
- 问题：从 Header 直接执行重要动作时，没有二次确认或操作摘要。
- 影响：高频日常使用中可能误触，尤其 execute 和 close 的业务影响较大。
- 建议：保留快捷入口，但增加紧凑确认 Sheet，确认对象、动作和当前状态。

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

### Global success feedback

- 位置：Resolution mutation 完成后
- 问题：成功主要依赖状态刷新体现，没有统一、短暂的成功反馈。
- 影响：用户可能不确定操作是否已经生效，尤其是页面局部变化不明显时。
- 建议：后续增加统一的轻量 toast 或状态过渡提示，不使用弹窗打断流程。

### Legacy workspace navigation consistency

- 位置：Operations 与 Workspace 导航
- 问题：Operations / Workspace 仍未迁移到 React 工作台，Header、账户区和交互模式与 Manufacturing 不完全一致。
- 影响：跨页面使用时存在产品感断层。
- 建议：在后续前端迁移阶段统一 Shell、身份区和导航行为。
