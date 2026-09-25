# 5 分钟评委演示脚本（Competition Judge Demo Script）

**总时长 5:00。一句话主线：订单承诺 100 件，MES 只完成 96 件 —— 系统怎么自己发现、拿证据、推闭环。**

演示前 30 秒准备（不在 5 分钟内）：

```bash
npm install
npm run demo:judge          # 约 3 秒跑完，输出 JUDGE_DEMO_VERIFIED
npm run demo                # 打开 http://127.0.0.1:3410 → 左侧导航「评委视图」
```

> 环境声明：**High-Fidelity Simulated Industrial Environment**。
> 事件顺序、多系统来源、UNS topic、mapping、connector、ledger、evidence、rule、exception、governance
> 全部真实执行；**只有「这家工厂」是仿真出来的**。open supOS 运行时为 `NOT_VERIFIED`。

---

## 0:00–0:30 工业问题（讲一句，不要讲架构）

> 「制造企业最常见的一类损失，不是某个系统报错，而是**跨系统的数字对不上**。
> 销售说承诺了 100 件，MES 说工单只完工 96 件，质检、仓库、财务各自都"正常"。
> 差异没人自动发现，发现了也说不清依据哪条数据，最后卡在'谁去过问'。」
>
> 「今天演示的就是这一条：**发现差异 → 给出可回源证据 → 推动到治理闭环**。」

屏幕：停在 `npm run demo:judge` 的 `[01] Industrial Simulation` 输出。

---

## 0:30–1:00 模拟 ERP / MES 数据进入

命令行：`npm run simulator:manufacturing -- --scenario production-shortfall --speed 100`

> 「这是仿真工厂：**16 条事件按 14 天工业日历发生**，来自 **7 个来源系统角色**
> ——ERP 下订单、MES 开工报工完工、QMS 检验、WMS 发货、财务开票收款、服务记录客诉。」
>
> 「注意每条事件带的是**该系统自己的字段名**：ERP 是 `order_qty`，MES 是 `completed_qty`。
> 我们没有把字段名改写成自己的形状。」

屏幕：`[02] UNS Semantic Mapping` → 显示 15 个 UNS topic 与留存载荷条数。

---

## 1:00–1:40 UNS + semantic mapping

命令行：`npm run demo:judge`（完整跑一遍，或接着上一个命令的输出往下讲）

> 「每个事件都会落到一个**标准 UNS topic**：
> `enterprise/demo-manufacturing/site/factory-shanghai-01/area/assembly-workshop/line/line-a/production/MO-IND-002/production.completed`
> —— 回答"发生在哪个工厂、哪个车间、哪条产线、哪台设备上"。」
>
> 「同一份声明式 Mapping Manifest 把 `completed_qty` 翻译成统一语义
> `ProductionOrder.completedQuantity`，再落到规范字段 `completedQty`。
> **没声明过的字段直接报错**，不允许悄悄进入证据链。」

屏幕：`evidence.json` 里的 `industrialContext` + `uns` 两段。

---

## 1:40–2:30 发现生产缺口

命令行输出：`[05] Rule Evaluation` / `[06] Exception`

> 「7 条规则**全部执行**（不是"没跑出来"当成"没问题"）：6 条不命中，**恰好 1 条命中**。
>
> 订单 100，MES 完工 96，**差异 4 件**，异常编码
> `ORDER_PRODUCTION_COMPLETION_SHORTFALL`。
>
> 关键是这个数字不是脚本写死的——它由规则引擎从证据里算出来，
> 换一个场景（正常/质检不合格/发货短少/回款短少），命中的组合会跟着变，
> 而且我们**对 5 个场景都做了 A/B 断言**（`npm run simulator:verify`）。」

屏幕：`[06] Exception` 的 PROOF 行（含异常 summary）。

---

## 2:30–3:20 证据回源（这一段最重要）

命令行：`npm run evidence:verify -- --context <contextId>`

> 「结论说完了，现在回答第二个问题：**凭什么信？**
>
> 这条异常依赖两条证据：订单 100 来自 **ERP-DEMO**，完工 96 来自 **MES-DEMO**。
> 每一条都要一路验下去：
> 证据 → 来源账本 → 载荷哈希（重算一致）→ mapping 版本可解析 →
> 来源位置 / UNS topic → 规范工业事件 → 原始系统。」

屏幕：`✓ raw_hash.match` 那一行，以及 `EVIDENCE_TRACE_VERIFIED`。

> 「注意这套检查是 **fail-closed** 的：拿不到留存载荷，就不算通过。
> 我们不会把"没检查"写成"已验证"。」

---

## 3:20–4:10 AI recommendation + 人类治理

命令行输出：`[07] Decision` / `[08] Governance`

> 「AI 在这里只做两件事：**解释**和**给候选动作**。
> 它**不可以**批准、**不可以**执行——这是写进契约的，不是提示词。」
>
> 「治理链是人：工程师受理 → 工程师复核 → 工程师提交 →
> **另一个人才可以批准**。演示里我们主动试了一次"同一个人批准自己提交的方案"，
> 系统直接拒绝：`SEGREGATION_OF_DUTIES_VIOLATION`。」

屏幕：`[08] Governance` 的 PROOF（proposer / approver 两个不同的 subjectId）。

> 想加深印象，可以现场加一句备用演示：
> `npm run demo:judge -- --scenario evidence-broken`
> → 「如果证据不可回源，异常照样报出来，但**审批和执行会被闸门挡住**，
> 状态是 `EVIDENCE_NOT_VERIFIABLE`。**证据不可靠就不允许执行。**」

---

## 4:10–4:40 execution verified

命令行输出：`[09] Execution` / `[10] Outcome`

> 「批准之后才执行。这里我们多做了一步：**执行完必须回读下游状态**。
>
> `requested → accepted → 回读 → verified`。
> 回读对不上就是 `failed`，绝不升级成 verified ——
> **API write 成功不等于业务动作完成**。」
>
> 「回读拿到 MES 补产后的完工回报：缺口 4 → 0，结果状态 `target_met`。
> 注意我们**不主张**是这个动作导致了归零，只报事实。」

屏幕：`execution-readback.json` 的 `readBack` 与 `mismatches=0`。

---

## 4:40–5:00 总结复用价值

> 「这条链上没有任何一个环节是为比赛现写的：
> Connector Runtime、Source Ledger、Evidence、Rule Engine、Resolution Governance、
> Outcome、Analytics 都是平台既有能力。」
>
> 「今天新增的只是把它们的**入口收敛成一条**：`npm run demo:judge` 一条命令，
> 一条 5 分钟能讲完的主线，一份评委能读懂的证据清单。
>
> **换一个工厂、换一个 MES 厂商，只需要换 Mapping Manifest 和场景参数，不改这条链。**」

收尾屏幕：`JUDGE_DEMO_VERIFIED` + `docs/competition/judge-acceptance-matrix.md`
（想追问的评委可以逐条核对 CLAIM / PROOF / COMMAND / TRUTH_STATUS）。

---

## 现场应急

| 情况 | 处理 |
| --- | --- |
| 端口被占 / UI 打不开 | 只讲 CLI：`npm run demo:judge` 输出已包含全部结论 |
| AI provider 不可用 | `--ai none`；`[07]` 显示 blocked，其余 10 步照常通过 |
| BI（Superset）不可用 | 正常。`[11] Analytics` 在本地确定性生成，不依赖 BI |
| 想重来一遍 | `npm run demo:judge:reset` 只清 `judge` 专属工作区 |
| 被问「这是真工厂吗」 | 明确回答：**不是**。这是高保真工业仿真；真实 MES/ERP/QMS/WMS 均未接入 |
