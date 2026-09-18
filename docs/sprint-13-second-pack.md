# Sprint 13 第二 Solution Pack

选择：**IT 运维告警处置**（FX-030）。

复用对象：`CaseStatus`、`ActionRecord`、批准前不可执行、Evidence locator。  
新增字段：`alertId` / `host` / `severity`，只出现在材料抽取，不改核心状态机。

证明：`tests/pack.test.ts` 中 IT alert 走同一 `runHappyPath`，状态仍是 `closed`，动作为 `create_task`。

若将来必须把 `CaseStatus` 改成告警专用枚举，则本条失败，不得宣传多行业平台。当前未改。
