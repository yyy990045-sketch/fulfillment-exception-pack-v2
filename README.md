# 履约例外调查系统 · Solution Pack

**跨系统履约差异的发现 · 回源 · 治理闭环**（制造业销售履约例外调查，琶洲参赛交付包）

> 环境声明：本仓库的工业演示运行在 **High-Fidelity Simulated Industrial Environment**（高保真工业仿真）。
> 链路是真的（事件顺序、多系统来源、UNS topic、mapping、connector、ledger、evidence、rule、exception、governance），
> **「工厂」是仿真出来的**：真实 MES / ERP / QMS / WMS 均未接入。

## 工业问题

制造企业最常见的一类损失不是某个系统报错，而是**跨系统的数字对不上**。

> 订单承诺 **100** 件，MES 工单只完工 **96** 件；
> 销售、生产、质检、仓库、财务各自"正常"，差异没人自动发现，
> 发现了也说不清依据哪条数据，最后卡在"谁去过问"。

这个仓库回答三个问题：**怎么自动发现差异**、**凭什么信这个结论**、**怎么推动到治理闭环**。

## 五步核心流程

```text
1  多系统数据        ERP / MES / QMS / WMS / Finance / CRM / Service 各自的原始字段
      ↓              16 条事件 · 14 天工业日历 · 7 个来源系统
2  UNS + 语义映射    标准 UNS topic（含工厂/车间/产线）+ 声明式 Mapping Manifest
      ↓
3  证据与回源        Connector Runtime → Source Ledger → Evidence
      ↓              逐条可回源：账本 → 载荷哈希 → mapping 版本 → UNS → 规范事件 → 原始系统
4  规则与异常        7 条规则全部执行 → 恰好 1 条命中 → 订单 100 vs 完工 96，差异 4
      ↓
5  治理闭环          AI 只解释与推荐 → 人受理 → 人提交 → 另一个人批准 → 执行 → 回读 → 结果
                     证据不可回源 → EVIDENCE_NOT_VERIFIABLE（异常保留，禁止审批与执行）
```

## 架构（一条链，不是 30 个框）

```text
Industrial Systems → open supOS / UNS → Semantic Mapping → Evidence Layer
  → Exception Engine → AI Assistance（advisory only）→ Human Governance
  → Execution / Outcome → Analytics（可选）
```

完整说明见 `docs/competition/architecture-one-page.md`。

## Quick Demo

```bash
npm install
npm run demo:judge
```

约 3 秒跑完 11 个阶段（每阶段都有 INPUT / PROCESS / OUTPUT / PROOF），输出：

```text
orderQuantity       = 100
productionCompleted = 96
difference          = 4
sourceSystems       = ERP-DEMO,MES-DEMO
exceptionCode       = ORDER_PRODUCTION_COMPLETION_SHORTFALL
traceStatus         = EVIDENCE_TRACE_VERIFIED
governanceStatus    = executed
executionStatus     = verified
outcomeStatus       = target_met

JUDGE_DEMO_VERIFIED
```

再花一条命令核对"凭什么信"：

```bash
npm run evidence:verify -- --context <上面输出的 contextId>
# → EVIDENCE_TRACE_VERIFIED（10 跳逐条 ✓）
```

想看界面：

```bash
npm run demo                                 # http://127.0.0.1:3410 → 左侧导航「评委视图」
npm run demo:judge -- --workspace data/pack-cases && PACK_STORE_DIR=data/pack-cases npm run demo
```

**不依赖**真实 MES / open supOS 运行时 / 外部 AI API / Power BI / Superset —— 都是可选增强。

## 备用演示（建议现场加演）

```bash
npm run demo:judge -- --scenario evidence-broken
```

人为制造「留存载荷与摄取时记录的哈希不一致」：异常照样被发现，但
**审批与执行被回源闸门挡住** → `EVIDENCE_NOT_VERIFIABLE`。
它证明的不是"AI 给了个答案"，而是**证据不可靠就不允许执行**。

## 比赛材料

| 文件 | 用途 |
| --- | --- |
| `docs/competition/judge-demo-30s.md` | 30 秒讲清楚 Problem / Input / Difference / Evidence / Governance / Value |
| `docs/competition/judge-demo-script.md` | 5 分钟逐段演示脚本（含现场应急） |
| `docs/competition/architecture-one-page.md` | 一页架构 |
| `docs/competition/judge-acceptance-matrix.md` | CLAIM → PROOF → COMMAND → ARTIFACT → TRUTH_STATUS 逐条核对 |
| `docs/industrial/` | 工业语义层：上下文模型 / UNS 约定 / Mapping Manifest / 工厂仿真器 |

## 命令

```bash
npm install

# 比赛主流程
npm run demo:judge                     # 11 阶段评委演示（默认 production-shortfall）
npm run demo:judge -- --scenario evidence-broken   # 备用：证据不可回源被闸门阻止
npm run demo:judge:reset               # 只清 judge 专属工作区（路径安全闸门）
npm run evidence:verify -- --context <id>          # 证据回源链验证

# 工业仿真
npm run simulator:manufacturing -- --scenario normal --speed 100
npm run simulator:verify               # 5 场景 A/B + 重放幂等 + topic/mapping 检查
npm run demo:industrial                # 十步完整工业演示

# 质量与运维
npm test && npm run frontend:test && npm run frontend:e2e && npm run typecheck && npm run eval
npm run open-supos:verify -- --mode contract
npm run db:verify-backup && npm run ops:recovery-drill
npm run demo                           # 本地服务 http://127.0.0.1:3410
```

## 本仓库定位

本仓库是便携演示 / 比赛发行物，**不是**企业平台本体。平台内核是 OpenELab（证据）和 qa-system（治理与 Coze 适配）。详见 `docs/OWNERSHIP.md`。

三个既有仓库只提供能力语义：OpenELab 的 fail-closed 与冲突不投票，qa-system 的批准门禁，Tongyue 的报价/订单/回款/客诉对象。本包用本地确定性抽取实现闭环，不连接真实 CRM，不调用三个生产库。

## 生产边界

生产启动至少需要设置 `NODE_ENV=production`、`DEMO_MODE=false` 和长度不少于 32 字节的 `AUTH_SECRET`。JWT 必须包含 `sub`、`tenant_id`、`roles`、`scopes`、`exp`；演示环境才允许 `x-tenant-id`/`x-actor` 兼容头。Docker 镜像使用 Node 24 以提供内置 SQLite，部署时请把 `/app/data` 挂载到持久卷并自行配置备份、迁移和密钥管理。

部署模板见 `.env.production.example`。复制后由密钥管理器注入 `AUTH_SECRET`，再运行 `docker compose -f docker-compose.deploy.yml up --build -d`；不要把真实密钥写回模板或提交到仓库。

`PACK_STORE_BACKEND=sqlite` 提供事务型本地存储；案件按租户隔离落盘；多端点证据刷新和结果回写均有审计记录。

## 比赛交付定位

这份仓库是最终工程与部署底座：可以本地或 Docker 启动、用生产模式 JWT 访问，并完成"证据 → 冲突 → 方案 → 审批 → 能力台账回执 → 核验结案"闭环。它对应官方赛道二的多源素材、事实抽取、冲突检测、行业报告和引用溯源要求；官方指定平台发布、体验链接、团队信息和最终报名表仍需在赛事平台完成，不能用本地地址替代。

## Sprint 对应

| Sprint | 本包位置 |
| --- | --- |
| 3 | `src/gold-set/cases.ts`、`gold-set/data-card.md` |
| 4 | `contracts/`、`src/case/runtime.ts` |
| 5-6 | `src/evidence/extract.ts`、`src/conflict/detect.ts` |
| 7-9 | `src/case/runtime.ts`、`src/agents/graph.ts` |
| 10 | `src/workbench/index.html`、`src/server.ts` |
| 11 | `src/eval/run.ts`、`tests/pack.test.ts` |
| 12-14 | `docs/` |

## 不做

- 不把本包扩成第四套大平台
- 不改客服/质检/Bear 主链路
- 不读写 Tongyue 真实 SQLite
- 不把 AMD/飞书旧材料放进 BP
- 不把仿真结果说成真实工厂 / 真实 MES 已验证
