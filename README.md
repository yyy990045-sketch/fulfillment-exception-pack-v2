# 履约例外调查系统 · Solution Pack

本仓库是便携演示 / 比赛发行物，**不是**企业平台本体。平台内核是 OpenELab（证据）和 qa-system（治理与 Coze 适配）。详见 `docs/OWNERSHIP.md`。

琶洲提交若使用本包，只带合成数据与安全演示，不把 OpenELab / qa-system 整库源码当作品。

```text
合成材料
  -> Evidence Pack（可回源事实与冲突）
  -> Case / Finding / Action（未批准不可执行）
  -> 本地能力台账回执与核验结案
```

三个既有仓库只提供能力语义：OpenELab 的 fail-closed 与冲突不投票，qa-system 的批准门禁，Tongyue 的报价/订单/回款/客诉对象。本包用本地确定性抽取实现闭环，不连接真实 CRM，不调用三个生产库。

当前参赛包范围：FX 30 案 + IT-001…IT-010；案件按租户隔离落盘；`resume()` 从暂停节点继续。默认是合成演示，但服务已提供可选生产边界：生产模式要求 bearer JWT，`PACK_STORE_BACKEND=sqlite` 提供事务型本地存储，多端点证据刷新和结果回写均有审计记录。

生产启动至少需要设置 `NODE_ENV=production`、`DEMO_MODE=false` 和长度不少于 32 字节的 `AUTH_SECRET`。JWT 必须包含 `sub`、`tenant_id`、`roles`、`scopes`、`exp`；演示环境才允许 `x-tenant-id`/`x-actor` 兼容头。Docker 镜像使用 Node 24 以提供内置 SQLite，部署时请把 `/app/data` 挂载到持久卷并自行配置备份、迁移和密钥管理。

部署模板见 `.env.production.example`。复制后由密钥管理器注入 `AUTH_SECRET`，再运行 `docker compose -f docker-compose.deploy.yml up --build -d`；不要把真实密钥写回模板或提交到仓库。

## 比赛交付定位

这份仓库是最终工程与部署底座：可以本地或 Docker 启动、用生产模式 JWT 访问，并完成“证据 → 冲突 → 方案 → 审批 → 能力台账回执 → 核验结案”闭环。它对应官方赛道二的多源素材、事实抽取、冲突检测、行业报告和引用溯源要求；官方指定平台发布、体验链接、团队信息和最终报名表仍需在赛事平台完成，不能用本地地址替代。

## 命令

```bash
cd /Users/xieweikai/Projects/fulfillment-exception-pack
npm install
npm test
npm run eval
npm run demo    # http://127.0.0.1:3410  先打开 FX-001
```

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
