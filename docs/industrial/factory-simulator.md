# Factory Simulator

> **SIMULATED INDUSTRIAL ENVIRONMENT.** 本文描述的数据源是仿真工厂。
> 「高保真」指的是链路保真：真实的事件顺序、真实的多系统来源、真实的 UNS topic、
> 真实的 mapping、connector、ledger、evidence、rule、exception、governance。
> **不是** 真实工厂，也不是真实 MES / ERP / QMS / WMS。

代码：`src/simulator/manufacturing/`

---

## 1 Simulator 不是 fixture loader

| | fixture（`SO-MFG-001`） | Factory Simulator |
| --- | --- | --- |
| 时间 | 一个写死的 `receivedAt` | 每条记录有自己的工业日历时刻，严格递增 |
| 来源 | 一次写入 | 每条记录来自不同系统（ERP/MES/QMS/WMS/Finance/CRM/Service） |
| 字段 | 已是领域字段 | **来源系统自己的原始字段名**（`completed_qty` / `ar_amount` / …） |
| 路径 | 直接 `store.save*` | UNS topic → Mapping Manifest → Connector Runtime → Ledger → Evidence → Rule |

仿真数据**不写进既有演示库**：`demo:industrial` 与 `simulator:manufacturing` 每次都在一个
全新的隔离工作区（默认 `.preview/...`，`--workspace` 可改）从空库开始。
因此「异常 = 0」这类结论不会因为历史数据而变成假象。

---

## 2 时间流

基准时刻 `2026-09-01T01:00:00.000Z`（= Asia/Shanghai 09:00，为确定性以 UTC 表示）。

| 阶段 | 工业日历偏移 | 来源系统 | 领域事件 |
| --- | --- | --- | --- |
| `quote.created` | 第 0 天 | CRM | `QUOTE_CREATED` |
| `order.created` | 第 0 天 +4h | ERP | `ORDER_CREATED` |
| `production.started` | 第 1 天 | MES | `PRODUCTION_STARTED` |
| `production.progressed` ×2 | 第 1 天 +5h / +10h | MES | `PRODUCTION_PROGRESSED` |
| `production.completed` | 第 3 天 | MES | `PRODUCTION_COMPLETED` |
| `quality.inspected` | 第 4 天 +1h | QMS | `QUALITY_INSPECTED` |
| `quality.passed` | 第 4 天 +5h | QMS | `QUALITY_PASSED` |
| `quality.failed` | 第 4 天 +5h05 | QMS | `QUALITY_FAILED` |
| `shipment.created` | 第 5 天 | WMS | `SHIPMENT_CREATED` |
| `shipment.dispatched` | 第 5 天 +2h | WMS | `SHIPMENT_DISPATCHED` |
| `shipment.received` | 第 7 天 | WMS | `SHIPMENT_SIGNED` |
| `invoice.created` | 第 7 天 +4h | Finance | `INVOICE_CREATED` |
| `receivable.created` | 第 7 天 +4h05 | Finance | `RECEIVABLE_CREATED` |
| `payment.received` | 第 12 天 | Finance | `PAYMENT_RECEIVED` |
| `complaint.created` | 第 14 天 | Service | `COMPLAINT_OPENED` |

共 16 条事件、7 个来源系统、15 个不同 UNS topic，工业日历跨度 14 天，
**任何两条事件都不会落在同一个 timestamp**。

每条记录还有 5 分钟的**观测延迟**（`observedAt = occurredAt + 5min`）：
数据先发生、后被系统写入并同步 —— 这个区分是 Evidence 能回答
「业务何时发生」与「我们何时知道」的前提。

### 播放速度

```
1 工业日 ≈ 1 秒（speed=1）；--speed 100 时整条 14 天时间线约 0.14 秒
```

`--speed 0` 表示不等速（校验与测试用）。`playbackSeconds()` 会把它如实打印出来。

---

## 3 确定性

```text
--seed <string>     默认 demo-seed-0001（固定，比赛现场不使用随机）
```

同一个 `scenario + seed` 必然生成**完全相同**的：

- 实体 ID（`ctx-…` / `entity-…` 由内容哈希派生）
- 事件顺序与 `messageId`
- 所有数值与 `rawHash`

seed 只影响**不影响判定结果**的现场细节：班次、操作员、报工时刻的分钟级抖动
（±90 分钟，不会跨过相邻事件）、以及元数据里的仿真标记。
因此换 seed 会改变现场质感，**不会改变业务结论** —— 这一点有测试守着。

PRNG 是 `seededRandom(seed)`（sha256 派生种子的 mulberry32），
代码里不存在 `Math.random()`。

---

## 4 场景

| 场景 | 订单 | 生产完工 | 质检(送检/合格) | 发货 | 回款 | 期望异常 |
| --- | --- | --- | --- | --- | --- | --- |
| `normal` | 100 | 100 | 100 / 100 | 100 | 100000/100000 | **0 个** |
| `production-shortfall` | 100 | **96** | 100 / 100 | 100 | 100000/100000 | **恰好 1 个** `ORDER_PRODUCTION_COMPLETION_SHORTFALL` |
| `quality-failure` | 100 | 100 | 100 / **94**（不合格 6） | **94** | 94000/94000 | `QUALITY_NONCONFORMING_QUANTITY_DETECTED` + `SHIPMENT_QUANTITY_SHORTFALL` |
| `shipment-shortfall` | 100 | 100 | **96 / 96** | **96** | 96000/96000 | **恰好 1 个** `SHIPMENT_QUANTITY_SHORTFALL` |
| `payment-shortfall` | 100 | 100 | 100 / 100 | 100 | **100000/80000** | **恰好 1 个** `PAYMENT_BALANCE_OUTSTANDING` |

每个场景都刻意让「不相关维度」保持自洽，从而命中的异常集合是可逐个归因的。

### 几处需要解释的取值（不是凑数）

- **production-shortfall**：工单只完工 96 件，缺口 4 件由**成品库存结转**补足，
  因此出货检验覆盖的是整个发货批次（96 + 4 = 100）。这让 `R6/R7` 不命中、
  `R2/R3/R4` 不命中 —— 恰好 1 个异常，且缺口被准确指向 MES。
- **quality-failure**：6 件不合格 → 可发货量降到 94 → WMS 只能发 94。
  第二个异常 `SHIPMENT_QUANTITY_SHORTFALL` 是**真实的 QMS→WMS 因果级联**，不是重复计数；
  两个异常的 metrics 互相印证（`nonconformingQty=6` 与 `shortfall=6`）。
- **shipment-shortfall**：工单完工 100，但本次只有 96 件放行进入出货检验，4 件留在成品待处理区。
  因此送检 96 = 合格 96 = 发货 96，只有 `R2` 命中，缺口被指向 WMS。

7 条规则**全部执行**（`evaluations = 7`），命中数才是异常数 —— 这条断言防止
「把规则没跑出来当成没有异常」。

---

## 5 Transport 抽象

Simulator 不直接依赖 open supOS：

```text
--transport local    直接推进 Connector Core 的缓冲队列（等价 injected transport，无序列化边界）
--transport inmem    MQTT 形状的内存 broker（同 topic 通配符、同 JSON 字符串载荷）
--transport mqtt     真实 MQTT broker；拿不到回执就 fail-closed
```

- `inmem` 不是「假装连上了 broker」：它只证明**序列化后的 UNS 载荷**能穿过
  `enterprise/+/site/+/area/+/line/+/+/+/+` 通配符并被连接器重新解析。
  `simulator:verify` 用它证明 local 与 MQTT 两条路径产出**同一份**仿真结果。
- `mqtt` 缺少 `OPEN_SUPOS_MQTT_URL` 时立即抛 `UNS_TRANSPORT_NOT_CONFIGURED`；
  收到回执数不等于发出数时抛 `UNS_TRANSPORT_DELIVERY_INCOMPLETE`。
  **绝不把「发出去了」说成「投递成功」。**
- MQTT 载荷就是 `OpenSuposInboundConnector` 现有契约的 `OpenSupOSUnsEnvelope`，
  不另造比赛专用协议。端点信息只保留 `protocol://host`，输出不含任何凭据。

将来真实 open supOS runtime 解锁后，同一个 simulator 只换 `--transport`，业务逻辑不变。

---

## 6 命令

```bash
# 单场景运行（默认 normal，1x 速度）
npm run simulator:manufacturing
npm run simulator:manufacturing -- --scenario production-shortfall --speed 100
npm run simulator:manufacturing -- --scenario payment-shortfall --seed demo-seed-0001 --json
npm run simulator:manufacturing -- --transport mqtt          # 需 OPEN_SUPOS_MQTT_URL

# A/B 验证闸门（5 个场景 + 重放幂等 + 多系统来源 + topic/mapping 检查）
npm run simulator:verify

# 一键完整演示（默认 production-shortfall，speed=100）
npm run demo:industrial
```

`simulator:manufacturing` 参数：`--scenario` / `--seed` / `--speed` / `--transport` /
`--workspace` / `--out` / `--json` / `--quiet`。

### `demo:industrial` 的十个步骤

```text
01 reset isolated demo workspace   全新空库
02 start simulator                 固定 seed / 场景 / 速度
03 emit events                     16 条事件、7 个来源系统、15 个 UNS topic
04 ingest                          UNS → Mapping Manifest → Connector Runtime
05 build context                   Business Context + ISA-95 归属
06 create evidence                 每条结论都能回答来源
07 evaluate rules                  7 条规则全部执行，逐条记录 observations
08 generate exception              异常数量由规则引擎决定，不是脚本写死
09 resolution capability           异常 → 可执行处置能力矩阵
10 analytics projection            运营分析投影（含 site/line/sourceSystem 维度）
```

末尾输出 `INDUSTRIAL_DEMO_VERIFIED` 以及 `contextId` / `eventCount` / `evidenceCount` /
`evaluationCount` / `exceptionCount` / `exceptionCode`，并写出两份可复核产物：

```text
<workspace>/artifacts/industrial-demo-canonical-events.jsonl   逐条规范工业事件（含 provenance）
<workspace>/artifacts/industrial-demo-trace.json              工业空间 + mapping 版本 + 异常 + 追溯链
```

产物与输出**不含任何 secret**。

想看界面时，把工作区指给现有演示服务即可（不改 UI 代码）：

```bash
npm run demo:industrial -- --workspace data/pack-cases
PACK_STORE_DIR=data/pack-cases npm run demo
```

---

## 7 验证与真值

`npm run simulator:verify` 的结论只能是 `INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED`：

```text
isa95.hierarchy                       层级可解析
mapping.coverage                      Order/Production/Quality/Shipment/Payment 全覆盖
uns.topic_convention                  全部 topic 符合 11 段约定
scenario.<each>                       逐场景：ledger / canonical / evaluations / 异常集合 / 重放
discrimination.normal_vs_shortfall    normal=0 且 production-shortfall=1 同时成立
replay.idempotent_all                 5 个场景重放：新账本=0 / 新事件=0 / 新异常=0 / cursor 不重复读
multisystem.sources                   7 个来源系统在所有场景中均参与
```

任一失败 → 整体 `FAILED`，且 `INDUSTRIAL_SIMULATOR_LOCALLY_VERIFIED=false`。
`REAL_MES_VERIFIED` / `REAL_ERP_VERIFIED` / `REAL_QMS_VERIFIED` / `REAL_WMS_VERIFIED` /
`REAL_FACTORY_VERIFIED` **恒为 false**：仿真通过再多次，也不等于接入了真实系统。

## 8 本轮没有做什么

不做 3D 数字孪生、不做 PLC 模拟器、不实现完整 ISA-95、不写 OPC UA Server、
不做第二套 ingestion framework、不实现真实 MES API、不做 open supOS live。

## 9 相关文档

- `docs/industrial/industrial-context-model.md` — 五个概念的边界与真值声明
- `docs/industrial/uns-topic-convention.md` — topic 式子
- `docs/industrial/mapping-manifest.md` — 字段翻译
- `docs/open-supos-integration.md` — 既有 open supOS 集成边界
