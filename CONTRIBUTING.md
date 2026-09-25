# 参与贡献

## 环境

- Node.js `>=22.5.0`。核心演示使用 Node 自带的 SQLite。
- npm。
- git。

核心演示不需要 Docker、Superset、Power BI、open supOS、JEV，也不需要真实 MQTT。这些都是可选外部运行时。

## 安装

```bash
npm install
npm run demo:judge
```

密钥放在被 git 忽略的 `.env` 文件里。只提交已经提供的 `.env.*.example`。

## 分支和提交

从当前主线拉出短分支，一次只做一件事。提交说明写清原因。

不要提交 `.env`、SQLite 数据库、备份、`.preview`、日志、覆盖率目录、私钥和令牌。

## 测试

改动后端时运行 `npm test`。改动界面时再运行 `npm run frontend:test`；改动端到端路径时运行 `npm run frontend:e2e`。提交前运行：

```bash
npm run typecheck
npm run truth:audit
```

和本次改动相关的演示或证据命令也要跑。例如主场景是 `npm run demo:judge`，证据是 `npm run evidence:verify`。

## 拉取请求

使用仓库里的拉取请求模板。说明：

- 跑了哪些测试；
- 文档是否要改；
- 有没有迁移；
- 安全和密钥；
- 租户隔离；
- 事实标记；
- 兼容性；
- 证据和来源有没有变化。

如果改动涉及外部集成，必须写明是真实运行时、只做了契约，还是只做了仿真。三者不能混写。

## 架构边界

当前主链只有一条：

```text
Industrial Systems → open supOS / UNS boundary → Semantic Mapping → Evidence → Exception → AI Assistance → Human Governance → Execution → Outcome → Analytics
```

依赖方向是 integration → domain → core。领域代码不直接依赖 MQTT、UNS 传输或 BI SDK。

## 事实边界

贡献者不能把下面三类说法写成真实工厂或生产环境已验证：

- simulated
- local verified
- contract verified

对应关系：

- 仿真工业环境不是真实工厂。
- 本地契约验证不是 open supOS 运行时已验证。
- Superset 的历史本地验证不是生产分析已验证。
- Jev 提供者验证不是真实客户决策质量已验证。

这些标记保持为 false：`REAL_CUSTOMER_VERIFIED`、`REAL_FACTORY_VERIFIED`、`REAL_MES_VERIFIED`、`REAL_OPEN_SUPOS_RUNTIME_VERIFIED`、`PRODUCTION_DEPLOYMENT_VERIFIED`。
