# 30 秒版本（Judge Demo 30s）

**Problem**

制造企业最常见的损失不是系统报错，而是**跨系统数字对不上**：销售承诺 100 件，MES 只完工 96 件，质检、仓库、财务各自都"正常"。差异没人自动发现，发现了也说不清依据。

**Input**

仿真工厂按 14 天工业日历产出 16 条事件，来自 7 个来源系统角色（ERP / MES / QMS / WMS / Finance / CRM / Service），每条带的是**该系统自己的字段名**（`order_qty`、`completed_qty`）。事件落到标准 UNS topic，经声明式 Mapping Manifest 翻译成统一工业语义。

**Difference**

7 条规则全部执行，**恰好 1 条命中**：订单 100 vs MES 完工 96，**差异 4 件**，异常 `ORDER_PRODUCTION_COMPLETION_SHORTFALL`。

**Evidence**

两条证据各自回源：订单 100 ← **ERP-DEMO**，完工 96 ← **MES-DEMO**；逐条校验 账本 → 载荷哈希（重算一致）→ mapping 版本 → 来源位置 / UNS topic → 规范工业事件 → 原始系统。

**Governance**

AI 只解释与推荐，**不能批准也不能执行**；人受理 → 人提交 → **另一个人批准**（SoD 实测拦截同人批准）。执行后必须**回读下游状态**，回读不一致就是 failed。证据不可回源时，异常照报，但审批与执行被闸门挡住 → `EVIDENCE_NOT_VERIFIABLE`。

**Value**

```bash
npm install && npm run demo:judge     # 一条命令，约 3 秒，输出 JUDGE_DEMO_VERIFIED
```

不依赖真实 MES、不依赖 open supOS 运行时、不依赖外部 AI、不依赖 BI。
换一个工厂或 MES 厂商，只需换 Mapping Manifest 与场景参数，**不改这条链**。

---

> 环境声明：High-Fidelity Simulated Industrial Environment（高保真工业仿真）。
> 不是真实工厂；`REAL_FACTORY_VERIFIED` / `REAL_MES_VERIFIED` / `REAL_OPEN_SUPOS_RUNTIME_VERIFIED` 均为 false。
