# Judge Contract v1.0

## Competition Identity

**履约哨兵 / Fulfillment Sentinel** 是基于 open supOS UNS 的跨系统生产履约状态冲突处置 APP。唯一 Judge 主链消费同一成品订单行的 ERP、MES、QMS、WMS 工业事实：确认业务关系和共同时间水位后，识别冲突，进入授权处置、现实状态回读、重新验证与关闭。

## NOT CLAIMED

- `REAL_OPEN_SUPOS_RUNTIME_VERIFIED=false`：当前演示不冒充真实 open supOS Runtime 验证。
- 演示不声称改变 ERP 订单、不声称客户接受短交，也不把审批或接口写入当作现实履约完成。
- LineCounter 只能作为可选的 OT 佐证，不是主链成立条件。

## Fact Authority

来源事实由各系统保持权威：ERP 提供 `Order.requiredQty`、`Order.dueAt` 和订单状态；MES 提供 `Production.completedQty` 与终态；QMS 提供 `Quality.releasedQty`；WMS 提供 `Shipment.executionCommittedQty`。履约哨兵只读取和关联这些事实，不改写它们。

## Business Lineage

Judge 使用确定性来源关系把 `ERP OrderLine → MES ProductionOrder → ProductionLot → QMS QualityLot → WMS ShipmentLine` 关联到 `SO-IND-001`。关系不完整、含糊或未解析时，结果为 `NOT_EVALUABLE` / `WAITING_FOR_SOURCE_PROGRESS`，不能开冲突；不依赖各系统使用相同的实体 ID，也不由 LLM 猜测。

## Source Progress / Watermark

每个必需来源都提供可解释的 `SOURCE_PROGRESS`。`Global Watermark = min(progress(ERP), progress(MES), progress(QMS), progress(WMS))`。只有当共同水位达到 `Order.dueAt + grace` 后，Judge 才允许评价终态冲突；否则显示 `WAITING_FOR_SOURCE_PROGRESS`，不误报为正常或冲突。

## Fulfillment State Contract

Judge 在 `asOf = Global Watermark` 的同一快照上，同时检查业务关联、交期后的共同水位、MES 终态、QMS 放行数量和 WMS 执行承诺数量。它输出可回溯的四源事实、关系、原因和当前 Judge Case。

## FULFILLMENT_STATE_CONFLICT@1.0

当且仅当：Business Lineage 已解析，`asOf >= dueAt + grace`，MES 为 `terminal`，`Quality.releasedQty < Order.requiredQty`，且 `Shipment.executionCommittedQty > Quality.releasedQty` 时，`ObservedStateConflict=true`，并产生唯一冲突编码 `FULFILLMENT_STATE_CONFLICT@1.0`。审批、Decision、Disposition 或 Case Status 都不能改变这个来源事实结论。

## Authority Binding

认证只确认可信主体，平台授权只确认可信角色或声明，业务授权再把角色绑定到订单或订单行范围和 `APPROVE_SHORT_SHIPMENT` 等动作。当前页面使用 `DEMO_POLICY_DUAL_ROLE` 双角色演示策略；这不是行业固定规则，也没有把 Keycloak Role 直接当成业务批准权。

## Disposition ≠ Conflict Resolution

授权短交 `AUTHORIZED_SHORT_SHIPMENT_96` 是独立的 Governed Disposition，表示“有人对当前冲突作出了授权处置决定”。它不改写 ERP.requiredQty，也不让 `ObservedStateConflict` 自动变为 false。WMS 仍为 100 时，Case 为 `WAITING_FOR_EXECUTION_VERIFICATION`。

## Closure Revalidation

Case E 需要新的 WMS 来源事实：`executionCommittedQty: 100 → 96`，并且 Source Progress / Global Watermark 推进。Judge 重新取共同快照；现实执行状态与授权处置一致后，才从 `REVALIDATED` 进入 `CLOSED`。关闭后再次出现违反约束的新来源事实时，仍可重新评价并 reopen。

## External Obligation Boundary

内部短交处置不等于客户合同变更。页面和读模型始终保留：`ERP.requiredQty` 仍为 100 件。关闭只能表述“内部跨系统状态冲突已按授权处置完成并重新验证”，不能声称客户已接受短交或对外义务已变更。

## Judge Cases A-E

| Case | 来源事实变化 | 结果 |
| --- | --- | --- |
| A | 100 / 100 / 100，终态，共同水位就绪 | `NO_CONFLICT` |
| B | 100 / 96 / 100，但必需来源水位未推进 | `WAITING_FOR_SOURCE_PROGRESS` |
| C | MES 96、QMS 96、WMS 100，终态且水位就绪 | `FULFILLMENT_STATE_CONFLICT` |
| D | 已授权短交 96，但 WMS 仍为 100 | `WAITING_FOR_EXECUTION_VERIFICATION`，冲突仍存在 |
| E | 新 WMS 事实为 96，水位推进并重新验证 | `REVALIDATED_CLOSED`，ERP 仍为 100 |

## 当前真实 open supOS Runtime 状态

`REAL_OPEN_SUPOS_RUNTIME_VERIFIED=false`。J1 交付的是本地可复现的 Judge Contract 和真实页面主链；真实 Source Flow / MQTT → UNS → Judge Path 验证留给后续阶段。
